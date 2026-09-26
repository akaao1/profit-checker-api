const PAGE="https://www.hareruya2.com/pages/buying-list";
const TERMS=["131/106","9500","hare2buy","product-list","買取","buying-list","/api/","fetch(","XMLHttpRequest","ajax"];
function allSnips(text:string,term:string){
  const out:any[]=[]; const lower=text.toLowerCase(); let from=0;
  while(out.length<20){const i=lower.indexOf(term.toLowerCase(),from);if(i<0)break;out.push(text.slice(Math.max(0,i-500),Math.min(text.length,i+1400)));from=i+term.length;}
  return out;
}
export default async function DebugHareruya(){
  const r=await fetch(PAGE,{cache:"no-store",headers:{"User-Agent":"Cross-Border-Seller-Radar/1.0 (authorized price collection)","Accept":"text/html,application/xhtml+xml"}});
  const html=await r.text();
  const urls=Array.from(new Set((html.match(/https?:\\/\\/[^"'\\s<>]+/gi)||[]).filter(u=>/hare2buy|product-list|buying-list|\\/api\\//i.test(u))));
  const out:any={status:r.status,length:html.length,counts:{},urls};
  for(const t of TERMS){const s=allSnips(html,t);out.counts[t]=s.length;if(s.length)out[t]=s;}
  return <main style={{fontFamily:"monospace",whiteSpace:"pre-wrap",padding:24}}>{JSON.stringify(out,null,2)}</main>;
}
