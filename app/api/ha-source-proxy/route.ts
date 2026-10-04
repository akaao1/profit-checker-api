import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_REQUEST_GAP_MS = 4000;
let lastSourceRequestAt = 0;

async function waitForSourceGap() {
  const now = Date.now();
  const wait = Math.max(0, MIN_REQUEST_GAP_MS - (now - lastSourceRequestAt));
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastSourceRequestAt = Date.now();
}

const SOURCE = "https://www.hareruya2.com";

function clean(s: string) {
  return s.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function parse(html: string) {
  const out: any[] = [];
  const seen = new Set<string>();
  const re = /href=["'](?:https?:\/\/[^"']+)?\/products\/([^"'?#]+)["']/gi;
  const links: {handle:string; pos:number}[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const handle = decodeURIComponent(m[1]);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle); links.push({handle,pos:m.index});
  }
  for (let i=0;i<links.length;i++) {
    const cur=links[i], end=links[i+1]?.pos ?? Math.min(html.length,cur.pos+20000);
    const block=clean(html.slice(cur.pos,end));
    const pm=block.match(/販売価格[:：]\s*[¥￥]\s*([0-9,]+)/);
    if (!pm) continue;
    const price=Number(pm[1].replace(/,/g,"")); if(!Number.isFinite(price)) continue;
    const soldOut=/SOLD\s*OUT|在庫なし|売り切れ/i.test(block);
    const sm=block.match(/在庫\s*(\d+)\s*(?:個|点|枚)?/);
    const qty=sm?Number(sm[1]):null;
    const body=block.replace(/^href=.*?>\s*/i,"").trim();
    const cardMatch=body.match(/〈[0-9]+\/[0-9]+〉/);
    const dashCardMatch=body.match(/〈-〉/);
    let title="";
    if(cardMatch || dashCardMatch){
      const cut=body.search(/\s単価\s*\/\s*あたり/);
      title=(cut>=0?body.slice(0,cut):body.slice(0,500)).trim()
        .replace(/^SOLD\s*OUT\s+/i,"")
        .replace(/\s*販売価格[:：].*$/,"")
        .trim();
    }
    if(!title || !/[〈〉]/.test(title)) continue;
    out.push({id:cur.handle,handle:cur.handle,title,price,available:!soldOut&&(qty==null||qty>0),inventory_quantity:qty});
  }
  return out;
}

export async function GET(req: Request) {
  const expected=process.env.HA_PROXY_SECRET;
  if(!expected || req.headers.get("x-ha-proxy-secret")!==expected)
    return NextResponse.json({error:"unauthorized"},{status:401});
  const u=new URL(req.url);
  const page=Math.max(1,Number(u.searchParams.get("page")||"1"));
  const collection=(u.searchParams.get("collection")||"all").replace(/[^a-zA-Z0-9_-]/g,"");
  const jsonUrl=SOURCE+"/collections/"+collection+"/products.json?limit=250&page="+page+"&sort_by=created-ascending";
  for (let attempt=0; attempt<3; attempt++) {
    await waitForSourceGap();
    const jr=await fetch(jsonUrl,{headers:{accept:"application/json","user-agent":"Cross-Border-Seller-Radar/6.5","accept-language":"ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7"},cache:"no-store"});
    if (jr.ok) {
      const jd=await jr.json();
      const products=Array.isArray(jd?.products)?jd.products:[];
      if (products.length) {
        return NextResponse.json({ok:true,page,collection,count:products.length,products},{headers:{"cache-control":"no-store"}});
      }
    }
    if (jr.status!==429 && jr.status<500) break;
    if (attempt<2) {
      const retryAfter=Number(jr.headers.get("retry-after")||"0");
      const backoff=retryAfter>0?Math.min(12000,retryAfter*1000):(4000*(attempt+1));
      await new Promise(resolve=>setTimeout(resolve,backoff));
    }
  }

  const url=SOURCE+"/collections/"+collection+"?page="+page+"&sort_by=created-ascending";
  let r: Response | null = null;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitForSourceGap();
    r = await fetch(url,{headers:{
      accept:"text/html,application/xhtml+xml",
      "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36",
      "accept-language":"ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7"
    },cache:"no-store"});
    if (r.ok) break;
    lastStatus = r.status;
    if (r.status !== 429 && r.status < 500) break;
    if (attempt < 2) {
      const retryAfter = Number(r.headers.get("retry-after") || "0");
      const backoff = retryAfter > 0 ? Math.min(12000, retryAfter * 1000) : (4000 * (attempt + 1));
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  if (!r) return NextResponse.json({error:"source_http",status:0},{status:502});
  const html=await r.text();
  if(!r.ok) return NextResponse.json({error:"source_http",status:lastStatus || r.status},{status:502});
  const products=parse(html);
  return NextResponse.json({ok:true,page,collection,count:products.length,products},{headers:{"cache-control":"no-store"}});
}

// 429 backoff, source pacing, and JSON collection pagination enabled
