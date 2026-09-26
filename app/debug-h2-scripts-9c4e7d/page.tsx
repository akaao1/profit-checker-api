const JSON_URL="https://api.corp.hareruyamtg.com/user_data/hareruya2/json/products_all.json";
export default async function DebugHareruya(){
  const r=await fetch(JSON_URL,{cache:"no-store",headers:{"User-Agent":"Cross-Border-Seller-Radar/1.0 (authorized price collection)","Accept":"application/json"}});
  const body=await r.text();
  let data:any=null;
  try{data=JSON.parse(body)}catch{}
  const products=Array.isArray(data?.products)?data.products:(Array.isArray(data)?data:[]);
  const matches=products.filter((p:any)=>{
    const s=JSON.stringify(p);
    return s.includes("131/106") || s.includes("ミロカロスex");
  }).slice(0,20);
  return <main style={{fontFamily:"monospace",whiteSpace:"pre-wrap",padding:24}}>{JSON.stringify({
    status:r.status,
    contentType:r.headers.get("content-type"),
    length:body.length,
    date:data?.date??null,
    productCount:products.length,
    matches
  },null,2)}</main>;
}
