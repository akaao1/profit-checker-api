import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Content-Type":"application/json; charset=utf-8"};
const CD="6147f366-d44f-40ce-a364-fdcdcb9dbf29",HA="7d8d8aaf-a197-4615-bf43-ecae1f62e0c2";
async function buildFallbackSpreadRankings(aliasMap:Map<string,string>,maxRows:number){
 const [cdResult,haResult]=await Promise.all([
  supabase.from("cd_current_stable_prices").select("product_id,price_jpy,observed_at").gt("price_jpy",0).order("observed_at",{ascending:false}).limit(10000),
  supabase.from("ha_current_stable_buy_prices").select("product_id,price_jpy,observed_at").gt("price_jpy",0).order("observed_at",{ascending:false}).limit(10000)
 ]);
 if(cdResult.error)throw cdResult.error;
 if(haResult.error)throw haResult.error;
 const cdByCanonical=new Map<string,any>(),haByCanonical=new Map<string,any>();
 for(const row of cdResult.data??[]){
  const id=aliasMap.get(row.product_id)??row.product_id,old=cdByCanonical.get(id);
  if(!old||Date.parse(row.observed_at)>Date.parse(old.observed_at))cdByCanonical.set(id,{...row,canonical_product_id:id});
 }
 for(const row of haResult.data??[]){
  const id=aliasMap.get(row.product_id)??row.product_id,old=haByCanonical.get(id);
  if(!old||Date.parse(row.observed_at)>Date.parse(old.observed_at))haByCanonical.set(id,{...row,canonical_product_id:id});
 }
 const pairIds=[...cdByCanonical.keys()].filter(id=>haByCanonical.has(id));
 const metadata=new Map<string,any>();
 for(let offset=0;offset<pairIds.length;offset+=500){
  const batch=await supabase.from("market_products").select("id,canonical_name,set_name,card_number,rarity").in("id",pairIds.slice(offset,offset+500));
  if(batch.error)throw batch.error;
  for(const row of batch.data??[])metadata.set(row.id,row);
 }
 const buckets:any={HA:[],CD:[]};
 for(const id of pairIds){
  const c=cdByCanonical.get(id),h=haByCanonical.get(id),m=metadata.get(id);
  if(!c||!h||!m||Number(c.price_jpy)<=0||Number(h.price_jpy)<=0||Number(c.price_jpy)===Number(h.price_jpy))continue;
  const diff=Number(h.price_jpy)-Number(c.price_jpy),channel=diff>0?"HA":"CD";
  buckets[channel].push({product_id:id,canonical_name:m.canonical_name,set_name:m.set_name,card_number:m.card_number,rarity:m.rarity,cd_price_jpy:Number(c.price_jpy),ha_price_jpy:Number(h.price_jpy),difference_jpy:diff,difference_percent:Number((Math.abs(diff)/Math.min(Number(c.price_jpy),Number(h.price_jpy))*100).toFixed(2)),cd_observed_at:c.observed_at,ha_observed_at:h.observed_at,cd_stale:Date.parse(c.observed_at)<Date.now()-60*60*1000,ha_stale:Date.parse(h.observed_at)<Date.now()-60*60*1000});
 }
 for(const channel of ["HA","CD"]){
  buckets[channel].sort((a:any,b:any)=>Math.abs(b.difference_jpy)-Math.abs(a.difference_jpy)||b.difference_percent-a.difference_percent||Math.max(Date.parse(b.cd_observed_at),Date.parse(b.ha_observed_at))-Math.max(Date.parse(a.cd_observed_at),Date.parse(a.ha_observed_at))||a.product_id.localeCompare(b.product_id));
  buckets[channel]=buckets[channel].slice(0,maxRows).map((row:any,index:number)=>({...row,rank:index+1}));
 }
 return buckets;
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  const u=new URL(req.url),q=(u.searchParams.get("q")??"").trim(),game=(u.searchParams.get("game")??"pokemon").trim().toLowerCase(),requestedProductId=(u.searchParams.get("product_id")??"").trim(),cardName=(u.searchParams.get("card_name")??"").trim(),cardNumber=(u.searchParams.get("card_number")??"").trim();
  const limit=Math.min(Number(u.searchParams.get("limit")??30)||30,100),opportunitiesOnly=u.searchParams.get("opportunities")==="1",days=Math.min(730,Math.max(7,Number(u.searchParams.get("days")??90))),gameRow=await supabase.from("game_registry").select("code,enabled,collection_enabled").eq("code",game).maybeSingle(),history=u.searchParams.get("history")==="1",allChanges=u.searchParams.get("all_changes")==="1",allSpreads=u.searchParams.get("all_spreads")==="1",onlyChanges=u.searchParams.get("only")==="changes";
  const aliasMap=new Map<string,string>();
  for(let offset=0;offset<10000;offset+=1000){
   const aliasPage=await supabase.from("cd_ha_set_name_alias_map").select("alias_product_id,canonical_product_id").range(offset,offset+999);
   if(aliasPage.error)throw aliasPage.error;
   for(const row of aliasPage.data??[])aliasMap.set(row.alias_product_id,row.canonical_product_id);
   if((aliasPage.data??[]).length<1000)break;
  }
  const aliasIds=new Set(aliasMap.keys());let productId=requestedProductId;if(productId&&aliasMap.has(productId))productId=aliasMap.get(productId)!;
  if(!gameRow.data)return new Response(JSON.stringify({ok:false,error:"unsupported_game",game}),{status:400,headers:cors});
  if(opportunitiesOnly){
   const opportunities=await supabase.rpc("get_ha_to_cd_opportunities",{p_limit:Math.min(limit,200),p_game:game});
   if(opportunities.error)throw opportunities.error;
   return new Response(JSON.stringify({ok:true,game,generated_at:new Date().toISOString(),opportunities:opportunities.data??[],warnings:[]}),{status:200,headers:cors});
  }
  if(productId||cardName||cardNumber||q){
   let searchQuery=supabase.from("market_products").select("id,canonical_name,set_name,card_number,rarity,variant_key,variant_base_name");
   searchQuery=searchQuery.eq("game",game);
   if(productId)searchQuery=searchQuery.eq("id",productId);
   else if(cardName&&cardNumber)searchQuery=searchQuery.ilike("canonical_name","%"+cardName+"%").ilike("card_number","%"+cardNumber+"%");
   else if(cardName)searchQuery=searchQuery.or("canonical_name.ilike.%"+cardName+"%,set_name.ilike.%"+cardName+"%");
   else if(cardNumber)searchQuery=searchQuery.ilike("card_number","%"+cardNumber+"%");
   else searchQuery=searchQuery.or("canonical_name.ilike.%"+q+"%,card_number.ilike.%"+q+"%,set_name.ilike.%"+q+"%");
   const search=await searchQuery.order("canonical_name").limit(50);if(search.error)throw search.error;
   const rows=(search.data??[]).filter((x:any)=>!aliasIds.has(x.id)),ids=rows.map((x:any)=>x.id);
   const current=ids.length?await supabase.rpc("get_current_buy_prices",{p_product_ids:ids}):{data:[],error:null};
   if(current.error)throw current.error;
   const crm=new Map((current.data??[]).filter((x:any)=>x.market_source_id===CD).map((x:any)=>[x.product_id,x]));
   const ham=new Map((current.data??[]).filter((x:any)=>x.market_source_id===HA).map((x:any)=>[x.product_id,x]));
   const haMeta=new Map<string,any>();
   const haCandidateQuery=supabase.from("market_products").select("id,game,canonical_name,set_name,card_number,rarity,variant_key,variant_base_name").eq("game",game);
   let hc:any=haCandidateQuery;
   if(productId) hc=hc.eq("id",productId);
   else if(cardName&&cardNumber) hc=hc.ilike("canonical_name","%"+cardName+"%").ilike("card_number","%"+cardNumber+"%");
   else if(cardName) hc=hc.or("canonical_name.ilike.%"+cardName+"%,set_name.ilike.%"+cardName+"%").limit(100);
   else if(cardNumber) hc=hc.ilike("card_number","%"+cardNumber+"%").limit(100);
   else hc=hc.or("canonical_name.ilike.%"+q+"%,card_number.ilike.%"+q+"%,set_name.ilike.%"+q+"%").limit(100);
   const hcm=await hc;if(hcm.error)throw hcm.error;for(const m of hcm.data??[])haMeta.set(m.id,m);
   const haIds=[...haMeta.keys()];
   const haRows=haIds.length?await supabase.from("ha_current_stable_buy_prices").select("product_id,price_jpy,observed_at").in("product_id",haIds):{data:[],error:null};
   if(haRows.error)throw haRows.error;
   const haByIdentity=new Map<string,any>();
   for(const hr of haRows.data??[]){const m=haMeta.get(hr.product_id);if(!m)continue;const key=m.card_number?[game,m.card_number,m.rarity??"",m.variant_key??"NORMAL"].map((v:any)=>String(v??"").normalize("NFKC").toLowerCase().trim()).join("|"):[game,m.canonical_name,m.set_name,m.rarity??""].map((v:any)=>String(v??"").normalize("NFKC").toLowerCase().trim()).join("|");const old=haByIdentity.get(key);if(!old||Date.parse(hr.observed_at)>Date.parse(old.observed_at))haByIdentity.set(key,{...hr,meta:m});}
   const prices=rows.map((x:any)=>{
     const direct=ham.get(x.id);const key=x.card_number?[game,x.card_number,x.rarity??"",x.variant_key??"NORMAL"].map((v:any)=>String(v??"").normalize("NFKC").toLowerCase().trim()).join("|"):[game,x.canonical_name,x.set_name,x.rarity??""].map((v:any)=>String(v??"").normalize("NFKC").toLowerCase().trim()).join("|");const matched=direct??haByIdentity.get(key);
     return {product_id:x.id,canonical_name:x.canonical_name,set_name:x.set_name,card_number:x.card_number,rarity:x.rarity,variant_key:x.variant_key??"NORMAL",variant_base_name:x.variant_base_name??x.canonical_name,cd_latest_price_jpy:crm.get(x.id)?.price_jpy??null,cd_latest_observed_at:crm.get(x.id)?.observed_at??null,ha_latest_price_jpy:matched?.price_jpy??null,ha_latest_observed_at:matched?.observed_at??null};
   });
   const displayRows:any[]=[];
   const displayPrices:any[]=[];
   const displayGroups=new Map<string,number[]>();
   for(let i=0;i<rows.length;i++){
    const x=rows[i];
    const key=[x.canonical_name,x.set_name,x.card_number,x.rarity,x.variant_key??"NORMAL",x.variant_base_name??x.canonical_name]
      .map((v:any)=>String(v??"").normalize("NFKC").toLowerCase().replace(/[ \\u3000]+/g," ").trim()).join("|");
    const group=displayGroups.get(key)??[];
    group.push(i);displayGroups.set(key,group);
   }
   for(const indices of displayGroups.values()){
    const signatures=indices.map(i=>String(prices[i].cd_latest_price_jpy??"null")+"|"+String(prices[i].ha_latest_price_jpy??"null"));
    if(indices.length===1||new Set(signatures).size>1){
     for(const i of indices){displayRows.push(rows[i]);displayPrices.push(prices[i]);}
     continue;
    }
    const best=indices.reduce((a,b)=>{
     const score=(i:number)=>{
      const p=prices[i];
      return Math.max(p.cd_latest_observed_at?Date.parse(p.cd_latest_observed_at):0,p.ha_latest_observed_at?Date.parse(p.ha_latest_observed_at):0);
     };
     return score(b)>score(a)?b:a;
    },indices[0]);
    displayRows.push(rows[best]);displayPrices.push(prices[best]);
   }
   let historyRows:any[]=[];
   if(history){
    if(productId){
     const h=await supabase.from("price_observations").select("product_id,price_jpy,observed_at,market_source_id").eq("product_id",productId).in("market_source_id",[CD,HA]).gte("observed_at",new Date(Date.now()-days*86400000).toISOString()).order("observed_at",{ascending:true}).limit(5000);
     if(h.error)throw h.error;const meta=rows.find((x:any)=>x.id===productId)||rows[0];
     historyRows=(h.data??[]).map((r:any)=>({product_id:r.product_id,canonical_name:meta?.canonical_name??null,set_name:meta?.set_name??null,card_number:meta?.card_number??null,rarity:meta?.rarity??null,variant_key:meta?.variant_key??"NORMAL",variant_base_name:meta?.variant_base_name??meta?.canonical_name??null,source_id:r.market_source_id,source_name:r.market_source_id===CD?"CD":"HA",observed_day:r.observed_at.slice(0,10),price_jpy:r.price_jpy,observed_at:r.observed_at}));
    }else{const h=await supabase.rpc("search_price_history",{p_query:cardNumber||cardName||q,p_days:days,p_limit:limit});if(h.error)throw h.error;historyRows=(h.data??[]).map((r:any)=>({...r,source_name:r.source_id===CD?"CD":r.source_id===HA?"HA":r.source_name}));}
   }
   return new Response(JSON.stringify({ok:true,game,generated_at:new Date().toISOString(),sources:[],prices:displayPrices,search:displayRows,history:historyRows,history_days:days,change_rankings:{CD:[],HA:[]},spread_rankings:{CD:[],HA:[]},collection_stats_24h:[]}),{status:200,headers:cors});
  }
  const warnings:any[]=[];
  const cacheResult=await supabase.from("price_change_ranking_cache").select("channel,rank,product_id,canonical_name,set_name,card_number,rarity,current_price_jpy,previous_price_jpy,change_jpy,change_percent,current_observed_at,previous_observed_at,generated_at").in("channel",["CD","HA"]).order("generated_at",{ascending:false}).limit(10000);
  if(cacheResult.error)throw cacheResult.error;
  const cachedRows=cacheResult.data??[];
  const cachedIds=[...new Set(cachedRows.map((r:any)=>r.product_id).filter(Boolean))];
  const allowedGameProducts=new Set<string>();
  for(let offset=0;offset<cachedIds.length;offset+=500){
    const p=await supabase.from("market_products").select("id").eq("game",game).in("id",cachedIds.slice(offset,offset+500));
    if(p.error)throw p.error; for(const row of p.data??[])allowedGameProducts.add(row.id);
  }
  const filteredChanges={CD:cachedRows.filter((r:any)=>r.channel==="CD"&&allowedGameProducts.has(r.product_id)).sort((a:any,b:any)=>Math.abs(Number(b.change_percent))-Math.abs(Number(a.change_percent))||String(b.current_observed_at).localeCompare(String(a.current_observed_at))||a.product_id.localeCompare(b.product_id)).slice(0,allChanges?10000:Math.min(limit,50)).map((r:any,i:number)=>({...r,rank:i+1})),HA:cachedRows.filter((r:any)=>r.channel==="HA"&&allowedGameProducts.has(r.product_id)).sort((a:any,b:any)=>Math.abs(Number(b.change_percent))-Math.abs(Number(a.change_percent))||String(b.current_observed_at).localeCompare(String(a.current_observed_at))||a.product_id.localeCompare(b.product_id)).slice(0,allChanges?10000:Math.min(limit,50)).map((r:any,i:number)=>({...r,rank:i+1}))};
  if(onlyChanges)return new Response(JSON.stringify({ok:true,game,generated_at:new Date().toISOString(),sources:[],prices:[],search:[],history:[],history_days:days,change_rankings:filteredChanges,spread_rankings:{CD:[],HA:[]},collection_stats_24h:[],warnings:[]}),{status:200,headers:cors});
  let spreadData:any={CD:[],HA:[]};
  const spreadRankings=await supabase.rpc("get_price_spread_rankings",{p_limit:allSpreads?10000:Math.min(limit,50),p_game:game});
  if(spreadRankings.error)warnings.push({feature:"spread_rankings",message:spreadRankings.error.message,code:spreadRankings.error.code??null});
  else {
    const raw=spreadRankings.data??{CD:[],HA:[]};
    const ids=[...(raw.CD??[]),...(raw.HA??[])].map((r:any)=>r.product_id).filter(Boolean);
    const allowed=new Set<string>();
    for(let offset=0;offset<ids.length;offset+=500){const p=await supabase.from("market_products").select("id").eq("game",game).in("id",ids.slice(offset,offset+500));if(p.error)throw p.error;for(const row of p.data??[])allowed.add(row.id)}
    spreadData={CD:(raw.CD??[]).filter((r:any)=>allowed.has(r.product_id)),HA:(raw.HA??[]).filter((r:any)=>allowed.has(r.product_id))};
  }
  if(!(spreadData.CD?.length||spreadData.HA?.length)){
   try{
    spreadData=await buildFallbackSpreadRankings(aliasMap,allSpreads?10000:Math.min(limit,50));
    const ids=[...(spreadData.CD??[]),...(spreadData.HA??[])].map((r:any)=>r.product_id).filter(Boolean); const allowed=new Set<string>();
    for(let offset=0;offset<ids.length;offset+=500){const p=await supabase.from("market_products").select("id").eq("game",game).in("id",ids.slice(offset,offset+500));if(p.error)throw p.error;for(const row of p.data??[])allowed.add(row.id)}
    spreadData={CD:(spreadData.CD??[]).filter((r:any)=>allowed.has(r.product_id)),HA:(spreadData.HA??[]).filter((r:any)=>allowed.has(r.product_id))};
    if(spreadData.CD.length||spreadData.HA.length)warnings.push({feature:"spread_rankings",message:"HAの通常現行価格ビューが空のため、現行HAリストへの掲載を確認した24時間以内の最新観測を使用しています。1時間を超える価格には更新遅延フラグが付きます。"});
   }catch(fallbackError){
    const e:any=fallbackError;
    warnings.push({feature:"spread_rankings_fallback",message:e?.message??String(fallbackError),code:e?.code??null});
   }
  }
  return new Response(JSON.stringify({ok:true,generated_at:new Date().toISOString(),sources:[],prices:[],search:[],history:[],history_days:days,change_rankings:filteredChanges,spread_rankings:spreadData,collection_stats_24h:[],warnings}),{status:200,headers:cors});
 }catch(error){console.error("radar-api error",error);const e:any=error;return new Response(JSON.stringify({ok:false,error:e?.message??String(error),details:e?.code??null,hint:e?.hint??null}),{status:500,headers:cors});}
});