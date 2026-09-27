import { createClient } from 'npm:@supabase/supabase-js@2'

const SOURCE_ID='6147f366-d44f-40ce-a364-fdcdcb9dbf29'
const BASE_URL='https://cardrush.media/pokemon/buying_prices'
const MIN_PRICE=1000

function cleanHtml(s:string){
  return s.replace(/<br\s*\/?>/gi,' ').replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'").replace(/&#x27;/gi,"'").replace(/\s+/g,' ').trim()
}
function normalize(v:string){
  return v.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ')
}
function parseRows(html:string){
  const rows:{name:string;pack:string;rarity:string;cardNumber:string;price:number;sourceProductKey:string;extraDifference:string}[]=[]
  const marker='<script id="__NEXT_DATA__"'
  const mi=html.indexOf(marker)
  if(mi<0) return rows
  const gt=html.indexOf('>',mi), close=html.indexOf('</script>',gt)
  if(gt<0||close<=gt) return rows
  try{
    const data=JSON.parse(html.slice(gt+1,close))
    const prices=data?.props?.pageProps?.buyingPrices
    if(!Array.isArray(prices)) return rows
    for(const x of prices){
      const price=Number(String(x?.amount??'').replace(/,/g,''))
      if(!Number.isFinite(price)||price<MIN_PRICE) continue
      const cardNumber=String(x?.model_number??'').trim(), baseName=String(x?.name??'').trim()
      const extraDifference=String(x?.extra_difference??'').trim()
      const name=extraDifference ? `${baseName}(${extraDifference})` : baseName
      const pack=String(x?.pack_code??x?.pack_name??'').trim(), rarity=String(x?.rarity??'').trim()
      const sourceProductKey=String(x?.id??x?.pokemon_ocha_product_id??'').trim()
      if(!name||!cardNumber||!sourceProductKey) continue
      rows.push({name,pack,rarity,cardNumber,price,sourceProductKey,extraDifference})
    }
  }catch(_e){ throw new Error('NEXT_DATA parse failed: '+String(_e)) }
  return rows
}
function normalizedKey(r:any){
  return [r.name,r.pack,r.rarity,r.cardNumber].map((v:any)=>normalize(String(v||''))).join('|')
}

Deno.serve(async(req)=>{
  let runId:string|null=null
  try{
    if(req.method!=='POST') return Response.json({error:'POST required'},{status:405})
    const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)
    const sb=createClient(Deno.env.get('SUPABASE_URL')!,secretKeys['default'])
    const provided=req.headers.get('x-cron-secret')||''
    const {data:expected}=await sb.rpc('cardrush_cron_token')
    if(!expected||provided!==expected) return Response.json({error:'unauthorized'},{status:401})

    const {data:state,error:stateError}=await sb.from('price_collection_state')
      .select('*').eq('market_source_id',SOURCE_ID).single()
    if(stateError) throw new Error(stateError.message)
    if(!state.pending_http_request_id) return Response.json({ok:true,status:'NO_PENDING_REQUEST'},{status:202})

    runId=state.current_run_id
    if(!runId){
      const {data:run,error}=await sb.from('price_fetch_runs')
        .insert({market_source_id:SOURCE_ID,status:'RUNNING'}).select('id').single()
      if(error) throw new Error(error.message)
      runId=run.id
      await sb.from('price_collection_state').update({current_run_id:runId,updated_at:new Date().toISOString()})
        .eq('market_source_id',SOURCE_ID)
    }

    const requestId=Number(state.pending_http_request_id)
    const page=Number(state.pending_page||state.next_page||1)
    const {data:responseRow,error:responseError}=await sb.rpc('read_cd_current_page',{p_request_id:requestId})
    if(responseError) throw new Error(responseError.message)
    if(!responseRow?.[0]?.content) return Response.json({ok:true,status:'PENDING',requestId,page},{status:202})

    const http=responseRow[0]
    if(Number(http.status_code)!==200) throw new Error('CD HTTP '+http.status_code)
    const html=String(http.content||'')
    if(!html) throw new Error('empty CD response')

    const url=new URL(BASE_URL)
    url.searchParams.set('displayMode','リスト')
    url.searchParams.set('limit','100')
    url.searchParams.set('page',String(page))

    await sb.from('price_collection_state').update({
      pending_http_request_id:null,pending_page:null,pending_requested_at:null,updated_at:new Date().toISOString()
    }).eq('market_source_id',SOURCE_ID).eq('pending_http_request_id',requestId)

    const structuredPayloadPresent = html.includes('"buyingPrices"') && html.includes('"lastPage"')
    if(!structuredPayloadPresent) throw new Error('CD structured payload missing on page '+page)
    let rows=parseRows(html)
    const dedup=new Map<string,any>()
    for(const r of rows) if(!dedup.has(normalizedKey(r))) dedup.set(normalizedKey(r),r)
    rows=[...dedup.values()]
    // A page can legitimately contain only prices below MIN_PRICE. It is still a successful page.

    const pageLinks=[...html.matchAll(/(?:[?&]|&amp;)page=(\d+)/g)].map(m=>Number(m[1])).filter(Number.isFinite)
    const discoveredMaxPages=pageLinks.length?Math.max(...pageLinks,page):Math.max(page,Number(state.max_pages||200))

    const cardNumbers=[...new Set(rows.map(r=>r.cardNumber).filter(Boolean))]
    const {data:aliasRows,error:aliasError}=await sb.from('cd_ha_set_name_alias_map').select('alias_product_id')
    if(aliasError) throw new Error(aliasError.message)
    const aliasIds=new Set((aliasRows||[]).map((x:any)=>x.alias_product_id))

    const existingByLoose=new Map<string,any[]>()
    if(cardNumbers.length){
      const {data:existing,error:existingError}=await sb.from('market_products')
        .select('id,normalized_key,canonical_name,set_name,card_number,rarity')
        .in('card_number',cardNumbers)
      if(existingError) throw new Error(existingError.message)
      for(const p of (existing||[])){
        if(aliasIds.has(p.id)) continue
        const k=normalize(String(p.canonical_name||''))+'|'+normalize(String(p.card_number||''))
        const arr=existingByLoose.get(k)||[];arr.push(p);existingByLoose.set(k,arr)
      }
    }

    const products=rows.map(r=>{
      const k=normalize(r.name)+'|'+normalize(r.cardNumber)
      const candidates=existingByLoose.get(k)||[]
      const existing=candidates.length===1?candidates[0]:null
      return existing
        ? {canonical_name:r.name,game:'pokemon',set_name:existing.set_name||r.pack||null,card_number:r.cardNumber||null,rarity:existing.rarity||r.rarity||null,normalized_key:existing.normalized_key}
        : {canonical_name:r.name,game:'pokemon',set_name:r.pack||null,card_number:r.cardNumber||null,rarity:r.rarity||null,normalized_key:normalizedKey(r)}
    })

    const {data:upserted,error:upsertError}=await sb.from('market_products')
      .upsert(products,{onConflict:'normalized_key'}).select('id,normalized_key')
    if(upsertError) throw new Error(upsertError.message)

    const idByKey=new Map((upserted||[]).map((p:any)=>[p.normalized_key,p.id]))
    const observedAt=new Date().toISOString()
    const observations=rows.map(r=>{
      const k=normalize(r.name)+'|'+normalize(r.cardNumber)
      const candidates=existingByLoose.get(k)||[]
      const existing=candidates.length===1?candidates[0]:null
      const variantIdentity=normalize(r.name)+'|'+normalize(r.pack)+'|'+normalize(r.rarity)+'|'+normalize(r.cardNumber)
      const sourceKey=`${r.sourceProductKey}|${variantIdentity}`
      const key=existing?.normalized_key||sourceKey
      const pid=idByKey.get(key)
      return pid?{
        market_source_id:SOURCE_ID,product_id:pid,fetch_run_id:runId,observed_at:observedAt,
        price_jpy:r.price,source_url:url.toString(),source_product_key:sourceKey,
        raw_payload:{...r,parser_version:16,collector:'cardrush_pgnet_processor',source_external_id:r.sourceProductKey}
      }:null
    }).filter(Boolean)

    for(let i=0;i<observations.length;i+=500){
      const {error:obsError}=await sb.from('price_observations').insert(observations.slice(i,i+500))
      if(obsError) throw new Error(obsError.message)
    }

    const completed=page>=discoveredMaxPages
    const nextPage=completed?1:page+1

    if(completed){
      const cycleStart=state.cycle_started_at||new Date(0).toISOString()
      const {data:cycleRows,error:cycleError}=await sb.from('price_observations')
        .select('source_product_key').eq('market_source_id',SOURCE_ID).gte('observed_at',cycleStart).not('source_product_key','is',null)
      if(cycleError) throw new Error(cycleError.message)
      const currentKeys=[...new Set((cycleRows||[]).map((r:any)=>String(r.source_product_key||'')).filter(Boolean))]
      if(!currentKeys.length) throw new Error('completed cycle has no source_product_key rows')
      const {error:syncError}=await sb.rpc('sync_source_current_listings',{
        p_market_source_id:SOURCE_ID,p_source_product_ids:currentKeys
      })
      if(syncError) throw new Error(syncError.message)
    }

    await sb.from('price_fetch_runs').update({
      pages_fetched:page,rows_seen:rows.length,rows_saved:observations.length,
      rows_filtered:0,status:completed?'SUCCESS':'RUNNING',
      finished_at:completed?new Date().toISOString():null,error_count:0,error_text:''
    }).eq('id',runId)

    await sb.from('price_collection_state').update({
      next_page:nextPage,max_pages:discoveredMaxPages,current_run_id:completed?null:runId,
      last_page_completed_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq('market_source_id',SOURCE_ID)

    return Response.json({
      ok:true,status:completed?'SUCCESS':'PAGE_SUCCESS',page,nextPage,maxPages:discoveredMaxPages,
      rowsSeen:rows.length,rowsSaved:observations.length,requestId
    })
  }catch(e){
    const msg=String(e)
    console.error('cardrush-price-processor error',msg)
    if(runId){
      const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)
      const sb=createClient(Deno.env.get('SUPABASE_URL')!,keys['default'])
      await sb.from('price_fetch_runs').update({
        finished_at:new Date().toISOString(),status:'FAILED',error_count:1,error_text:msg
      }).eq('id',runId)
      await sb.from('price_collection_state').update({
        current_run_id:null,pending_http_request_id:null,pending_page:null,pending_requested_at:null,updated_at:new Date().toISOString()
      }).eq('market_source_id',SOURCE_ID)
    }
    return Response.json({ok:false,error:msg},{status:500})
  }
})
