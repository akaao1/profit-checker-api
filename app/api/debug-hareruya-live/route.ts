export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "https://www.hareruya2.com/pages/buying-list";

export async function GET() {
  const response = await fetch(PAGE, {
    cache: "no-store",
    headers: {
      "User-Agent": "Cross-Border-Seller-Radar/1.0 (authorized price collection)",
      "Accept": "text/html,application/xhtml+xml"
    }
  });
  const html = await response.text();
  const scripts = [];
  const re = /<script[^>]*src=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html)) !== null && scripts.length < 80) {
    scripts.push(match[1]);
  }
  const signals = ["131/106", "9500", "buying-list", "hare2buy", "kaitori", "買取"];
  const found = {};
  for (const term of signals) found[term] = html.includes(term);
  return Response.json({
    status: response.status,
    contentType: response.headers.get("content-type"),
    length: html.length,
    signals: found,
    scripts,
    head: html.slice(0, 12000)
  });
}
