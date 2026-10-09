import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PROJECT_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb=createClient(PROJECT_URL,SERVICE_KEY);

const SOURCES:Record<string,{game:string,url:string,maxPages:number,min:number}> = {
 "11111111-1111-4111-8111-111111111111":{game:"one_piece",url:"https://cardrush.media/onepiece/buying_prices",maxPages:30,min:1000},
 "22222222-2222-4222-8222-222222222222":{game:"yugioh",url:"https://cardrush.media/yugioh/buying_prices",maxPages:100,min:1000},
 "33333333-3333-4333-8333-333333333333":{game:"mtg",url:"https://cardrush.media/mtg/buying_prices",maxPages:50,min:0},
};

const norm=(v:string|null|undefined)=>String(v??"").normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");
const strip=(v:string)=>v.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();

function parseRows(html:string,source:{game:string}){
 const rows:any[]=[];
 for(const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...m[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(x=>strip(x[1])).filter(Boolean);
  if(cells.length<3) continue;
  const pi=cells.findIndex(x=>/¥|￥/.test(x)&&/\d/.test(x));
  if(pi<0) continue;
  const pm=cells[pi].match(/([0-9][0-9,]*)/); if(!pm) continue;
  const price=Number(pm[1].replace(/,/g,"")); if(!Number.isFinite(price)) continue;
  const non=cells.filter((_,i)=>i!==pi);
  if(source.game==="mtg"){
   const name=non[0]??""; const setName=non[1]??null; const language=non[2]??"日本語";
   if(!name) continue;
   rows.push({name,setName,cardNumber:null,rarity:null,variantKey:language,price});
  } else {
   const name=non[0]??""; const rarity=non[1]??null; const cardNumber=non.find(x=>/[A-Z0-9]+[-/][A-Z0-9-]+/.test(x))??null;
   if(!name) continue;
   rows.push({name,setName:null,cardNumber,rarity,variantKey:"NORMAL",price});
  }
 }
 const seen=new Set<string>();
 return rows.filter(r=>r.price>=0&&r.price>= (source.game==="mtg"?0:1000)).filter(r=>{
   const k=[source.game,r.name,r.setName,r.cardNumber,r.rarity,r.variantKey].map(norm).join("|");
   if(seen.has(k))return false; seen.add(k); r.key=k; return true;
 });
}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok");
 if(req.method!=="POST") return Response.json({error:"POST required"},{status:405});
 const secret=await sb.rpc("cardrush_cron_token").then(r=>r.data).catch(()=>null);
 if(!secret || req.headers.get("x-cron-secret")!==secret) return Response.json({error:"unauthorized"},{status:401});
 const body=await req.json().catch(()=>({}));
 const sourceId=String(body.source_id||"");
 const source=SOURCES[sourceId]; if(!source)return Response.json({error:"unsupported source_id"},{status:400});

 const claim=await sb.from("multigame_price_collection_state").update({locked_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("source_id",sourceId).or("locked_at.is.null,locked_at.lt."+new Date(Date.now()-15*60*1000).toISOString()).select("source_id").maybeSingle();
 if(claim.error)return Response.json({error:claim.error.message},{status:500});
 if(!claim.data)return Response.json({ok:true,status:"busy",source_id:sourceId},{status:202});
 const {data:state,error:stateErr}=await sb.from("multigame_price_collection_state").select("*").eq("source_id",sourceId).single();
 if(stateErr)return Response.json({error:stateErr.message},{status:500});

 let cycleId=state.current_cycle_id;
 let page=state.next_page||1;
 // Abandon an incomplete cycle after 24 hours so stale partial-cycle rows cannot
 // block fresh observations or be mistaken for a current completed snapshot.
 const staleCycle=Boolean(cycleId && state.last_success_at && Date.now()-new Date(state.last_success_at).getTime()>24*60*60*1000);
 if(staleCycle){cycleId=crypto.randomUUID();page=1;const reset=await sb.from("multigame_price_collection_state").update({next_page:1,current_cycle_id:cycleId,updated_at:new Date().toISOString()}).eq("source_id",sourceId);if(reset.error)throw new Error(reset.error.message);}
 if(!cycleId){cycleId=crypto.randomUUID(); await sb.from("multigame_price_collection_state").update({current_cycle_id:cycleId,updated_at:new Date().toISOString()}).eq("source_id",sourceId);}
 const run=await sb.from("price_fetch_runs").insert({market_source_id:sourceId,status:"RUNNING"}).select("id").single();
 if(run.error)return Response.json({error:run.error.message},{status:500});

 let total=0,saved=0,pages=0,finished=false;
 try{
  for(let i=0;i<(state.pages_per_run||5);i++){
   if(page>source.maxPages){finished=true;break;}
   const url=source.url+"?displayMode=%E3%83%AA%E3%82%B9%E3%83%88&limit=100&page="+page;
   const res=await fetch(url,{cache:"no-store",headers:{"User-Agent":"Cross-Border-Seller-Radar/1.0","Accept":"text/html,application/xhtml+xml"}});
   if(!res.ok)throw new Error("source HTTP "+res.status+" page "+page);
   const html=await res.text();
   const rows=parseRows(html,source); total+=rows.length; pages++;
   if(rows.length===0){finished=true;break;}
   const products=rows.map(r=>({
     canonical_name:r.name,game:source.game,set_name:r.setName,card_number:r.cardNumber,
     rarity:r.rarity,variant_key:r.variantKey,variant_base_name:r.name,
     normalized_key:[source.game,r.name,r.setName,r.cardNumber,r.rarity,r.variantKey].map(norm).join("|")
   }));
   const up=await sb.from("market_products").upsert(products,{onConflict:"normalized_key"}).select("id,normalized_key");
   if(up.error)throw new Error(up.error.message);
   const ids=new Map((up.data||[]).map((p:any)=>[p.normalized_key,p.id]));
   const now=new Date().toISOString();
   const obs=rows.map(r=>({
     market_source_id:sourceId,product_id:ids.get(r.key),fetch_run_id:run.data.id,observed_at:now,
     price_jpy:r.price,source_url:url,source_product_key:r.key,
     raw_payload:{game:source.game,parser_version:2,cycle_id:cycleId,page,source_url:url}
   })).filter((x:any)=>x.product_id);
   // A source page can contain aliases/variants that normalize to the same product.
   // The DB intentionally permits only one observation per product per collection cycle.
   const pageUnique=[...new Map(obs.map((x:any)=>[x.product_id,x])).values()];
   const existing=await sb.from("price_observations").select("product_id").eq("market_source_id",sourceId).filter("raw_payload->>cycle_id","eq",cycleId);
   if(existing.error)throw new Error("cycle dedupe lookup: "+existing.error.message);
   const seen=new Set((existing.data||[]).map((x:any)=>x.product_id));
   const fresh=pageUnique.filter((x:any)=>!seen.has(x.product_id));
   for(let j=0;j<fresh.length;j+=500){const batch=fresh.slice(j,j+500);const ins=await sb.from("price_observations").insert(batch);if(ins.error)throw new Error(ins.error.message);saved+=batch.length;batch.forEach((x:any)=>seen.add(x.product_id));}
   page++;
   if(page>source.maxPages){finished=true;break;}
  }
  if(finished){
   await sb.from("multigame_price_collection_state").update({next_page:1,current_cycle_id:null,last_completed_cycle_id:cycleId,last_success_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("source_id",sourceId);
  }else{
   await sb.from("multigame_price_collection_state").update({next_page:page,updated_at:new Date().toISOString()}).eq("source_id",sourceId);
  }
  await sb.from("price_fetch_runs").update({finished_at:new Date().toISOString(),status:"SUCCESS",pages_fetched:pages,rows_seen:total,rows_saved:saved,rows_filtered:0,error_count:0}).eq("id",run.data.id);
  await sb.from("multigame_price_collection_state").update({locked_at:null,updated_at:new Date().toISOString()}).eq("source_id",sourceId); return Response.json({ok:true,game:source.game,pages,rowsSeen:total,rowsSaved:saved,nextPage:finished?1:page,cycleId,cycleCompleted:finished});
 }catch(e){
  await sb.from("price_fetch_runs").update({finished_at:new Date().toISOString(),status:"FAILED",pages_fetched:pages,rows_seen:total,rows_saved:saved,error_count:1,error_text:String(e)}).eq("id",run.data.id);
  await sb.from("multigame_price_collection_state").update({locked_at:null,updated_at:new Date().toISOString()}).eq("source_id",sourceId); return Response.json({error:String(e),game:source.game,pages,rowsSaved:saved},{status:502});
 }
});