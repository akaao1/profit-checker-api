import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SOURCES:Record<string,{game:string,url:string}>={
 "41111111-1111-4111-8111-111111111111":{game:"one_piece",url:"https://kaitori-toretoku.jp/buypricelist/onepiece"},
 "42222222-2222-4222-8222-222222222222":{game:"yugioh",url:"https://kaitori-toretoku.jp/buypricelist/yugioh"},
 "43333333-3333-4333-8333-333333333333":{game:"mtg",url:"https://kaitori-toretoku.jp/buypricelist/mtg"}
};
const norm=(v:string|null|undefined)=>String(v??"").normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");
const decode=(s:string)=>s.replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"');
function parse(html:string,game:string){
 const out:any[]=[]; const liRe=new RegExp('<li[^>]*>[^]*?</li>','gi');
 for(const m of html.matchAll(liRe)){
  const b=m[0];
  const attr=(n:string)=>{const x=b.match(new RegExp('data-'+n+'="([^"]*)"','i'));return x?decode(x[1]):""};
  const name=attr("name"),cardNumber=attr("modelnumber")||null,setName=attr("pack")||null,rarity=attr("rarity")||null,price=Number((attr("price")||"").replace(/,/g,""));
  if(!name||!Number.isFinite(price)||price<=0)continue;
  const key=[game,name,cardNumber,rarity,setName].map(norm).join("|");
  if(out.some(x=>x.key===key))continue;
  out.push({name,cardNumber,setName,rarity,price,key});
 }
 return out;
}

Deno.serve(async(req)=>{
 if(req.method!=="POST")return Response.json({error:"POST required"},{status:405});
 const secret=await sb.rpc("cardrush_cron_token").then(r=>r.data).catch(()=>null);
 if(!secret||req.headers.get("x-cron-secret")!==secret)return Response.json({error:"unauthorized"},{status:401});
 const body=await req.json().catch(()=>({})); const sourceId=String(body.source_id||""); const source=SOURCES[sourceId];
 if(!source)return Response.json({error:"unsupported source_id"},{status:400});
 const run=await sb.from("sale_fetch_runs").insert({sale_source_id:sourceId,status:"RUNNING"}).select("id").single();
 if(run.error)return Response.json({error:run.error.message},{status:500});
 const cycleId=crypto.randomUUID();
 try{
  const res=await fetch(source.url,{cache:"no-store",headers:{"User-Agent":"Cross-Border-Seller-Radar/1.0","Accept":"text/html,application/xhtml+xml"}});
  if(!res.ok)throw new Error("source HTTP "+res.status);
  const html=await res.text(); const rows=parse(html,source.game);
  if(!rows.length)throw new Error("No structured buyback rows discovered");
  const products=rows.map(r=>({canonical_name:r.name,game:source.game,set_name:null,card_number:r.cardNumber,rarity:r.rarity,variant_key:"NORMAL",variant_base_name:r.name,normalized_key:[source.game,r.name,r.cardNumber,r.rarity,"NORMAL"].map(norm).join("|")}));
  const up=await sb.from("market_products").upsert(products,{onConflict:"normalized_key"}).select("id,normalized_key");
  if(up.error)throw new Error(up.error.message);
  const ids=new Map((up.data||[]).map((p:any)=>[p.normalized_key,p.id])); const now=new Date().toISOString();
  const obs=rows.map(r=>({sale_fetch_run_id:run.data.id,sale_source_id:sourceId,product_id:ids.get([source.game,r.name,r.cardNumber,r.rarity,"NORMAL"].map(norm).join("|")),external_product_key:r.key,product_name:r.name,card_number:r.cardNumber,set_code:null,rarity:r.rarity,condition_label:"A",sale_price_jpy:r.price,stock_qty:1,in_stock:true,source_url:source.url,observed_at:now,raw_payload:{game:source.game,cycle_id:cycleId,parser_version:1,source_url:source.url},variant_key:"NORMAL",variant_base_name:r.name,stock_qty_source:"public_buyback_list",stock_qty_observed_at:now})).filter((x:any)=>x.product_id);
  for(let i=0;i<obs.length;i+=500){const ins=await sb.from("sale_observations").insert(obs.slice(i,i+500));if(ins.error)throw new Error(ins.error.message);}
  await sb.from("sale_fetch_runs").update({finished_at:now,status:"SUCCESS",pages_scanned:1,products_seen:rows.length,observations_written:obs.length,opportunities_found:0,error_count:0}).eq("id",run.data.id);
  return Response.json({ok:true,game:source.game,rowsSeen:rows.length,observationsWritten:obs.length,cycleId});
 }catch(e){await sb.from("sale_fetch_runs").update({finished_at:new Date().toISOString(),status:"FAILED",error_count:1,error_message:String(e)}).eq("id",run.data.id);return Response.json({error:String(e)},{status:502});}
});