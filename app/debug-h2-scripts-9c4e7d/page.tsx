const PAGE="https://www.hareruya2.com/pages/buying-list";
const TERMS=["131/106","9500","hare2buy","product-list","買取","buying-list","/api/","fetch(","XMLHttpRequest","ajax"];
function snippets(text:string,term:string){
  const out:string[]=[]; const lower=text.toLowerCase(); let from=0;
  while(out.length<6){
    const i=lower.indexOf(term.toLowerCase(),from);
    if(i<0) break;
    out.push(text.slice(Math.max(0,i-700),Math.min(text.length,i+1800)));
    from=i+term.length;
  }
  return out;
}
export default async function DebugHareruya(){
  const r=await fetch(PAGE,{cache:"no-store",headers:{"User-Agent":"Cross-Border-Seller-Radar/1.0 (authorized price collection)","Accept":"text/html,application/xhtml+xml"}});
  const html=await r.text();
  const counts:any={};
  const samples:any={};
  for(const term of TERMS){const s=snippets(html,term);counts[term]=s.length;if(s.length)samples[term]=s;}
  return <main style={{fontFamily:"monospace",whiteSpace:"pre-wrap",padding:24}}>{JSON.stringify({status:r.status,length:html.length,counts,samples},null,2)}</main>;
}
