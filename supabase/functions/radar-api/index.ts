import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Content-Type":"application/json; charset=utf-8"};
const CD="6147f366-d44f-40ce-a364-fdcdcb9dbf29",HA="7d8d8aaf-a197-4615-bf43-ecae1f62e0c2";
async function buildFallbackSpreadRankings(aliasMap:Map<string,string>,maxRows:number){
 const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
 const [cdResult,listingResult]=await Promise.all([
  supabase.from("cd_current_stable_prices").select("product_id,price_jpy,observed_at").gt("price_jpy",0).order("observed_at",{ascending:false}).limit(10000),
  supabase.from("source_current_listings").select("source_product_id,checked_at").eq("market_source_id",HA).gte("checked_at",cutoff).limit(10000)
 ]);
 if(cdResult.error)throw cdResult.error;
 if(listingResult.error)throw listingResult.error;
 const listings=listingResult.data??[];
 const listingIds=new Set(listings.map((x:any)=>String(x.source_product_id)));
 const cdByCanonical=new Map<string,any>();
 for(const row of cdResult.data??[]){
  const id=aliasMap.get(row.product_id)??row.product_id;
  const old=cdByCanonical.get(id);
  if(!old||Date.parse(row.observed_at)>Date.parse(old.observed_at))cdByCanonical.set(id,{...row,canonical_product_id:id});
 }
 const haByCanonical=new Map<string,any>();
 const idsByCanonical=new Map<string,Set<string>>();
 for(const id of cdByCanonical.keys())idsByCanonical.set(id,new Set([id]));
 for(const [alias,canonical] of aliasMap.entries()){
  if(idsByCanonical.has(canonical))idsByCanonical.get(canonical)!.add(alias);
 }
 const relevantIds=[...new Set([...idsByCanonical.values()].flatMap(x=>[...x]))];
 const currentListingIds=new Set(listings.map((x:any)=>String(x.source_product_id)));
 const idBatches:string[][]=[];
 for(let offset=0;offset<relevantIds.length;offset+=100)idBatches.push(relevantIds.slice(offset,offset+100));
 const haPages=await Promise.all(idBatches.map(ids=>supabase.from("price_observations")
  .select("id,product_id,price_jpy,observed_at,created_at,raw_payload")
  .eq("market_source_id",HA).in("product_id",ids).gte("observed_at",cutoff).gt("price_jpy",0)
  .order("observed_at",{ascending:false}).order("created_at",{ascending:false}).limit(1000)));
 for(const page of haPages){
  if(page.error)throw page.error;
  for(const row of page.data??[]){
   const sourceProductId=String(row.raw_payload?.source_product_id??"");
   if(!sourceProductId||!currentListingIds.has(sourceProductId))continue;
   const id=aliasMap.get(row.product_id)??row.product_id;
   const old=haByCanonical.get(id);
   if(!old||Date.parse(row.observed_at)>Date.parse(old.observed_at)||
      (row.observed_at===old.observed_at&&Date.parse(row.created_at)>Date.parse(old.created_at))){
    haByCanonical.set(id,{...row,canonical_product_id:id});
   }
  }
 }
 const pairIds:string[]=[];
 for(const id of cdByCanonical.keys())if(haByCanonical.has(id))pairIds.push(id);
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
  const diff=Number(h.price_jpy)-Number(c.price_jpy);
  const channel=diff>0?"HA":"CD";
  buckets[channel].push({
   product_id:id,canonical_name:m.canonical_name,set_name:m.set_name,card_number:m.card_number,rarity:m.rarity,
   cd_price_jpy:Number(c.price_jpy),ha_price_jpy:Number(h.price_jpy),difference_jpy:diff,
   difference_percent:Number((Math.abs(diff)/Math.min(Number(c.price_jpy),Number(h.price_jpy))*100).toFixed(2)),
   cd_observed_at:c.observed_at,ha_observed_at:h.observed_at,
   cd_stale:Date.parse(c.observed_at)<Date.now()-60*60*1000,
   ha_stale:Date.parse(h.observed_at)<Date.now()-60*60*1000
  });
 }
 for(const channel of ["HA","CD"]){
  buckets[channel].sort((a:any,b:any)=>Math.abs(b.difference_jpy)-Math.abs(a.difference_jpy)||b.difference_percent-a.difference_percent||Date.parse(b.ha_observed_at)-Date.parse(a.ha_observed_at)||a.product_id.localeCompare(b.product_id));
  buckets[channel]=buckets[channel].slice(0,maxRows).map((row:any,index:number)=>({...row,rank:index+1}));
 }
 return buckets;
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  const u=new URL(req.url),q=(u.searchParams.get("q")??"").trim(),requestedProductId=(u.searchParams.get("product_id")??"").trim(),cardName=(u.searchParams.get("card_name")??"").trim(),cardNumber=(u.searchParams.get("card_number")??"").trim();
  const limit=Math.min(Number(u.searchParams.get("limit")??30)||30,100),days=Math.min(730,Math.max(7,Number(u.searchParams.get("days")??90))),history=u.searchParams.get("history")==="1",allChanges=u.searchParams.get("all_changes")==="1",allSpreads=u.searchParams.get("all_spreads")==="1",onlyChanges=u.searchParams.get("only")==="changes";
  const aliasRows=await supabase.from("cd_ha_set_name_alias_map").select("alias_product_id,canonical_product_id");if(aliasRows.error)throw aliasRows.error;
  const aliasMap=new Map((aliasRows.data??[]).map((x:any)=>[x.alias_product_id,x.canonical_product_id]));const aliasIds=new Set(aliasMap.keys());let productId=requestedProductId;if(productId&&aliasMap.has(productId))productId=aliasMap.get(productId)!;
  if(productId||cardName||cardNumber||q){
   let searchQuery=supabase.from("market_products").select("id,canonical_name,set_name,card_number,rarity,variant_key,variant_base_name");
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
   const prices=rows.map((x:any)=>({product_id:x.id,canonical_name:x.canonical_name,set_name:x.set_name,card_number:x.card_number,rarity:x.rarity,variant_key:x.variant_key??"NORMAL",variant_base_name:x.variant_base_name??x.canonical_name,cd_latest_price_jpy:crm.get(x.id)?.price_jpy??null,cd_latest_observed_at:crm.get(x.id)?.observed_at??null,ha_latest_price_jpy:ham.get(x.id)?.price_jpy??null,ha_latest_observed_at:ham.get(x.id)?.observed_at??null}));
   let historyRows:any[]=[];
   if(history){
    if(productId){
     const h=await supabase.from("price_observations").select("product_id,price_jpy,observed_at,market_source_id").eq("product_id",productId).in("market_source_id",[CD,HA]).gte("observed_at",new Date(Date.now()-days*86400000).toISOString()).order("observed_at",{ascending:true}).limit(5000);
     if(h.error)throw h.error;const meta=rows.find((x:any)=>x.id===productId)||rows[0];
     historyRows=(h.data??[]).map((r:any)=>({product_id:r.product_id,canonical_name:meta?.canonical_name??null,set_name:meta?.set_name??null,card_number:meta?.card_number??null,rarity:meta?.rarity??null,variant_key:meta?.variant_key??"NORMAL",variant_base_name:meta?.variant_base_name??meta?.canonical_name??null,source_id:r.market_source_id,source_name:r.market_source_id===CD?"CD":"HA",observed_day:r.observed_at.slice(0,10),price_jpy:r.price_jpy,observed_at:r.observed_at}));
    }else{const h=await supabase.rpc("search_price_history",{p_query:cardNumber||cardName||q,p_days:days,p_limit:limit});if(h.error)throw h.error;historyRows=(h.data??[]).map((r:any)=>({...r,source_name:r.source_id===CD?"CD":r.source_id===HA?"HA":r.source_name}));}
   }
   return new Response(JSON.stringify({ok:true,generated_at:new Date().toISOString(),sources:[],prices,search:rows,history:historyRows,history_days:days,change_rankings:{CD:[],HA:[]},spread_rankings:{CD:[],HA:[]},collection_stats_24h:[]}),{status:200,headers:cors});
  }
  const warnings:any[]=[];
  const changeRankings=await supabase.rpc("get_price_change_rankings",{p_limit:allChanges?10000:Math.min(limit,50)});
  if(changeRankings.error)throw changeRankings.error;
  if(onlyChanges)return new Response(JSON.stringify({ok:true,generated_at:new Date().toISOString(),sources:[],prices:[],search:[],history:[],history_days:days,change_rankings:changeRankings.data??{CD:[],HA:[]},spread_rankings:{CD:[],HA:[]},collection_stats_24h:[],warnings:[]}),{status:200,headers:cors});
  let spreadData:any={CD:[],HA:[]};
  const spreadRankings=await supabase.rpc("get_price_spread_rankings",{p_limit:allSpreads?10000:Math.min(limit,50)});
  if(spreadRankings.error)warnings.push({feature:"spread_rankings",message:spreadRankings.error.message,code:spreadRankings.error.code??null});
  else spreadData=spreadRankings.data??{CD:[],HA:[]};
  if(!(spreadData.CD?.length||spreadData.HA?.length)){
   try{
    spreadData=await buildFallbackSpreadRankings(aliasMap,allSpreads?10000:Math.min(limit,50));
    if(spreadData.CD.length||spreadData.HA.length)warnings.push({feature:"spread_rankings",message:"HAの通常現行価格ビューが空のため、現行HAリストへの掲載を確認した24時間以内の最新観測を使用しています。1時間を超える価格には更新遅延フラグが付きます。"});
   }catch(fallbackError){
    const e:any=fallbackError;
    warnings.push({feature:"spread_rankings_fallback",message:e?.message??String(fallbackError),code:e?.code??null});
   }
  }
  return new Response(JSON.stringify({ok:true,generated_at:new Date().toISOString(),sources:[],prices:[],search:[],history:[],history_days:days,change_rankings:changeRankings.data??{CD:[],HA:[]},spread_rankings:spreadData,collection_stats_24h:[],warnings}),{status:200,headers:cors});
 }catch(error){console.error("radar-api error",error);const e:any=error;return new Response(JSON.stringify({ok:false,error:e?.message??String(error),details:e?.code??null,hint:e?.hint??null}),{status:500,headers:cors});}
});