export const runtime = "nodejs";

const PAGE = "https://www.hareruya2.com/pages/buying-list";
const ORIGIN = "https://www.hareruya2.com";

function abs(u:string){
  try { return new URL(u, ORIGIN).toString(); } catch { return null; }
}

export async function GET(){
  const res = await fetch(PAGE, {
    headers: {
      "User-Agent": "Cross-Border-Seller-Radar/1.0 (authorized price collection)",
      "Accept": "text/html,application/xhtml+xml"
    },
    cache: "no-store"
  });
  const html = await res.text();

  const scriptSrcs = Array.from(
    html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi),
    m => abs(m[1])
  ).filter((x): x is string => Boolean(x));

  const candidateUrls = new Set<string>();
  const addCandidates = (source:string) => {
    const patterns = [
      /https?:\\/\\/[^"'\\s<>]+/gi,
      /\\/[^"'\\s<>]*(?:api|buy|price|purchase|kaitori)[^"'\\s<>]*/gi
    ];
    for (const re of patterns) {
      for (const m of source.matchAll(re)) {
        const u = abs(m[0]);
        if (u && u.length < 500) candidateUrls.add(u);
      }
    }
  };
  addCandidates(html);

  const scriptReports:any[] = [];
  for (const src of scriptSrcs.slice(0, 60)) {
    try {
      const sr = await fetch(src, {
        headers: {
          "User-Agent": "Cross-Border-Seller-Radar/1.0 (authorized price collection)",
          "Accept": "*/*"
        },
        cache: "no-store"
      });
      const body = await sr.text();
      addCandidates(body);
      const lower = body.toLowerCase();
      const terms = ["buying-list","131/106","9500","買取","kaitori","price","api/","product-list","hare2buy"];
      const hits = terms.filter(t => lower.includes(t.toLowerCase()));
      if (hits.length) {
        const snippets = hits.slice(0, 6).map(term => {
          const i = lower.indexOf(term.toLowerCase());
          return i >= 0 ? body.slice(Math.max(0,i-500), Math.min(body.length,i+1200)) : "";
        });
        scriptReports.push({src, size:body.length, hits, snippets});
      }
    } catch (e) {
      scriptReports.push({src, error:String(e)});
    }
  }

  return Response.json({
    page: {
      status: res.status,
      contentType: res.headers.get("content-type"),
      length: html.length
    },
    htmlSignals: {
      has131: html.includes("131/106"),
      has9500: html.includes("9500"),
      hasBuyingList: html.includes("buying-list"),
      hasHare2Buy: html.includes("hare2buy")
    },
    scriptSrcs,
    candidateUrls: Array.from(candidateUrls).slice(0,300),
    scriptReports
  });
}
