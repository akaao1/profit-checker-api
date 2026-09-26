export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "https://www.hareruya2.com/pages/buying-list";
const ORIGIN = "https://www.hareruya2.com";

function absolute(u:string){
  try { return new URL(u, ORIGIN).toString(); } catch { return null; }
}

function urlsFrom(text:string){
  const out = new Set<string>();
  const re = /https?:\\/\\/[^"'\\s<>]+|\\/[^"'\\s<>]*(?:api|ajax|json|buy|price|purchase|kaitori|product-list)[^"'\\s<>]*/gi;
  let m;
  while((m=re.exec(text))!==null){
    const u=absolute(m[0]);
    if(u && u.length<700) out.add(u);
  }
  return Array.from(out);
}

export async function GET() {
  const response = await fetch(PAGE, {
    cache: "no-store",
    headers: {
      "User-Agent": "Cross-Border-Seller-Radar/1.0 (authorized price collection)",
      "Accept": "text/html,application/xhtml+xml"
    }
  });
  const html = await response.text();

  const scripts:string[] = [];
  const re = /<script[^>]*src=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html)) !== null && scripts.length < 80) {
    const u=absolute(match[1]);
    if(u) scripts.push(u);
  }

  const terms = ["131/106","9500","buying-list","kaitori","買取","product-list","hare2buy","fetch(","$.ajax","/api/","graphql","json"];
  const reports:any[]=[];
  const candidate = new Set<string>(urlsFrom(html));

  for(const src of scripts.slice(0,80)){
    try{
      const sr=await fetch(src,{cache:"no-store",headers:{
        "User-Agent":"Cross-Border-Seller-Radar/1.0 (authorized price collection)",
        "Accept":"*/*"
      }});
      const body=await sr.text();
      const lower=body.toLowerCase();
      const hits=terms.filter(t=>lower.includes(t.toLowerCase()));
      const snippets:any[]=[];
      for(const term of hits.slice(0,8)){
        const i=lower.indexOf(term.toLowerCase());
        if(i>=0) snippets.push({term,text:body.slice(Math.max(0,i-700),Math.min(body.length,i+1800))});
      }
      for(const u of urlsFrom(body)) candidate.add(u);
      if(hits.length) reports.push({src,status:sr.status,size:body.length,hits,snippets});
    }catch(e){
      reports.push({src,error:String(e)});
    }
  }

  return Response.json({
    page:{status:response.status,length:html.length},
    htmlSignals:Object.fromEntries(terms.map(t=>[t,html.toLowerCase().includes(t.toLowerCase())])),
    scripts,
    candidateUrls:Array.from(candidate).slice(0,400),
    reports
  });
}
