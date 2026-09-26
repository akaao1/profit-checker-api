export const runtime = "nodejs";

const PAGE = "https://www.hareruya2.com/pages/buying-list";
const ORIGIN = "https://www.hareruya2.com";

function uniq<T>(xs:T[]){return [...new Set(xs)]}
function abs(u:string){try{return new URL(u,ORIGIN).toString()}catch{return null}}

export async function GET(){
  const res = await fetch(PAGE,{headers:{
    "User-Agent":"Cross-Border-Seller-Radar/1.0 (authorized price collection)",
    "Accept":"text/html,application/xhtml+xml"
  },cache:"no-store"});
  const html = await res.text();
  const scriptSrcs = uniq([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>abs(m[1])).filter(Boolean) as string[]);
  const inline = [...html.matchAll(/<script(?![^>]+src=)[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(m=>m[1]).join("\\n");
  const candidateUrls = new Set<string>();
  const addCandidates=(s:string)=>{
    for(const m of s.matchAll(/(?:https?:\\/\\/[^"'\\s<>]+|\\/[^"'\\s<>]*(?:api|buy|price|purchase|kaitori)[^"'\\s<>]*)/gi)){
      const u=abs(m[0]); if(u && u.length<500) candidateUrls.add(u);
    }
  };
  addCandidates(html); addCandidates(inline);
  const scriptReports:any[]=[];
  for(const src of scriptSrcs.slice(0,80)){
    try{
      const sr=await fetch(src,{headers:{"User-Agent":"Cross-Border-Seller-Radar/1.0 (authorized price collection)","Accept":"*/*"},cache:"no-store"});
      const text=await sr.text();
      addCandidates(text);
      const hits:string[]=[];
      for(const term of ["buying-list","131/106","9500","買取","kaitori","price","api/","product-list","hare2buy"]){
        if(text.toLowerCase().includes(term.toLowerCase())) hits.push(term);
      }
      if(hits.length) scriptReports.push({src,size:text.length,hits,snippets:hits.slice(0,6).map(term=>{
        const i=text.toLowerCase().indexOf(term.toLowerCase());
        return i>=0?text.slice(Math.max(0,i-500),Math.min(text.length,i+1200)):"";
      })});
    }catch(e){scriptReports.push({src,error:String(e)})}
  }
  return Response.json({
    page:{status:res.status,contentType:res.headers.get("content-type"),length:html.length},
    htmlSignals:{
      has131:html.includes("131/106"),
      has9500:html.includes("9500"),
      hasBuyingList:html.includes("buying-list"),
      hasHare2Buy:html.includes("hare2buy")
    },
    scriptSrcs,
    candidateUrls:[...candidateUrls].slice(0,300),
    scriptReports
  });
}
