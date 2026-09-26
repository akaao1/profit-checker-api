const SCRIPTS = [
  "https://www.hareruya2.com/cdn/shop/t/4/assets/custom-global.js?v=18681160730400539971708074071",
  "https://www.hareruya2.com/cdn/shop/t/4/compiled_assets/scripts.js?v=24438321893151416171761207486",
  "https://www.hareruya2.com/cdn/shop/t/4/assets/constants.js?v=95358004781563950421708074071"
];
const TERMS = ["131/106","9500","buying-list","kaitori","買取","product-list","hare2buy","fetch(","ajax","/api/","graphql","json"];

export default async function DebugHareruya(){
  const reports:any[]=[];
  for(const src of SCRIPTS){
    try{
      const r=await fetch(src,{cache:"no-store",headers:{
        "User-Agent":"Cross-Border-Seller-Radar/1.0 (authorized price collection)",
        "Accept":"*/*"
      }});
      const body=await r.text();
      const lower=body.toLowerCase();
      const hits=TERMS.filter(t=>lower.includes(t.toLowerCase()));
      const snippets=hits.map(term=>{
        const i=lower.indexOf(term.toLowerCase());
        return {term,text:body.slice(Math.max(0,i-900),Math.min(body.length,i+2200))};
      });
      reports.push({src,status:r.status,size:body.length,hits,snippets});
    }catch(e){reports.push({src,error:String(e)})}
  }
  return <main style={{fontFamily:"monospace",whiteSpace:"pre-wrap",padding:24}}>
    {JSON.stringify({generatedAt:new Date().toISOString(),reports},null,2)}
  </main>;
}
