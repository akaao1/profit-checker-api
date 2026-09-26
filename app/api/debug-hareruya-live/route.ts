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
  const scripts:string[] = [];
  const re = /<script[^>]*src=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html)) !== null && scripts.length < 80) scripts.push(match[1]);
  return Response.json({
    status: response.status,
    length: html.length,
    has131: html.includes("131/106"),
    has9500: html.includes("9500"),
    scripts,
    head: html.slice(0, 12000)
  });
}
