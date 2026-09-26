export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCRIPTS = [
  "https://www.hareruya2.com/cdn/shop/t/4/assets/custom-global.js?v=18681160730400539971708074071",
  "https://www.hareruya2.com/cdn/shop/t/4/compiled_assets/scripts.js?v=24438321893151416171761207486",
  "https://www.hareruya2.com/cdn/shop/t/4/assets/constants.js?v=95358004781563950421708074071"
];

export async function GET() {
  const terms = ["131/106","9500","buying-list","kaitori","買取","product-list","hare2buy","fetch(","ajax","/api/","graphql","json"];
  const reports:any[] = [];
  for (const src of SCRIPTS) {
    const r = await fetch(src, {
      cache: "no-store",
      headers: {
        "User-Agent": "Cross-Border-Seller-Radar/1.0 (authorized price collection)",
        "Accept": "*/*"
      }
    });
    const body = await r.text();
    const lower = body.toLowerCase();
    const hits = terms.filter(t => lower.includes(t.toLowerCase()));
    const snippets:any[] = [];
    for (const term of hits) {
      const i = lower.indexOf(term.toLowerCase());
      if (i >= 0) snippets.push({term, text: body.slice(Math.max(0,i-1000), Math.min(body.length,i+2500))});
    }
    reports.push({src,status:r.status,size:body.length,hits,snippets});
  }
  return Response.json({reports});
}
