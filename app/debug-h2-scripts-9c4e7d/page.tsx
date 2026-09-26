const PAGE="https://www.hareruya2.com/pages/buying-list";
const TERMS=["131/106","9500","buying-list","kaitori","買取","product-list","hare2buy","fetch(","XMLHttpRequest","ajax","/api/","graphql","application/json","data-","iframe","iframe"];
function snippets(text:string,term:string){
  const out:any[]=[]; const lower=text.toLowerCase(); let from=0;
  while(out.length<8){const i=lower.indexOf(term.toLowerCase(),from);if(i<0)break;out.push(text.slice(Math.max(0,i-1200),Math.min(text.length,i+3200)));from=i+term.length;}
  return out;
}
export default async function DebugHareruya(){
  const r=await fetch(PAGE,{cache:"no-store",headers:{"User-Agent":"Cross-Border-Seller-Radar/1.0 (authorized price collection)","Accept":"text/html,application/xhtml+xml"}});
  const html=await r.text();
  const reports=TERMS.map(term=>({term,count:snippets(html,term).length,snippets:snippets(html,term)}));
  return <main style={{fontFamily:"monospace",whiteSpace:"pre-wrap",padding:24}}>{JSON.stringify({status:r.status,length:html.length,reports},null,2)}</main>;
}
