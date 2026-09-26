const PAGE="https://www.hareruya2.com/pages/buying-list";
function snippets(text:string,term:string){
  const out:string[]=[]; const lower=text.toLowerCase(); let from=0;
  while(out.length<12){
    const i=lower.indexOf(term.toLowerCase(),from);
    if(i<0) break;
    out.push(text.slice(Math.max(0,i-1400),Math.min(text.length,i+3200)));
    from=i+term.length;
  }
  return out;
}
export default async function DebugHareruya(){
  const r=await fetch(PAGE,{cache:"no-store",headers:{"User-Agent":"Cross-Border-Seller-Radar/1.0 (authorized price collection)","Accept":"text/html,application/xhtml+xml"}});
  const html=await r.text();
  const terms=["jsonUrl","jsonUrl =","fetch(jsonUrl)","mainData.products","mainData.date","loadInitialData","seriesMap","updateFilteredProducts"];
  const out:any={status:r.status,length:html.length};
  for(const term of terms) out[term]=snippets(html,term);
  return <main style={{fontFamily:"monospace",whiteSpace:"pre-wrap",padding:24}}>{JSON.stringify(out,null,2)}</main>;
}
