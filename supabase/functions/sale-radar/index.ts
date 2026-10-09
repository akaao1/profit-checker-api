import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "content-type": "application/json",
};
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const CD_SOURCE_ID = "6147f366-d44f-40ce-a364-fdcdcb9dbf29";
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s: unknown) => clean(s).normalize("NFKC").replace(/[ 　]/g, "");
const variantKey = (s: unknown) => {
  const x = norm(s);
  const parts = [];
  if (x.includes("マスターボールミラー")) parts.push("MASTERBALL_MIRROR");
  else if (x.includes("モンスターボールミラー")) parts.push("MONSTERBALL_MIRROR");
  else if (x.includes("ミラー")) parts.push("MIRROR");
  if (x.includes("未開封")) parts.push("UNOPENED");
  return parts.length ? parts.join("+") : "NORMAL";
};
const variantBase = (s: unknown) => clean(s).normalize("NFKC")
  .replace(/(マスターボールミラー|モンスターボールミラー|ミラー|未開封)/gi, "")
  .replace(/[（(][ 　/]*[）)]/g, "")
  .replace(/\/[）)]/g, ")")
  .replace(/[（(]\//g, "(")
  .replace(/（/g, "(")
  .replace(/）/g, ")")
  .replace(/[ 　]+/g, " ")
  .replace(/[:：]+$/, "")
  .trim();

function parseTitle(title: string) {
  const t = clean(title);
  const m = t.match(/^(?:〖|【)状態([A-D])([+-])?(?:〗|】)/);
  const condition_label = m ? m[1] + (m[2] ?? "") : "A";
  const card_number = (t.match(/〈([^〉]+)〉/) || [])[1] ?? null;
  const set_code = (t.match(/〈[^〉]+〉\s*\[([^\]]+)\]/) || [])[1] ?? null;
  const rarity = (t.match(/\(([^)]+)\)/) || [])[1] ?? null;
  const name = t
    .replace(/^(?:〖|【)状態[A-D][+-]?(?:〗|】)/, "")
    .replace(/^(?:〖|【)[^〗】]*(?:未開封|マスターボールミラー|モンスターボールミラー|ミラー)[^〗】]*(?:〗|】)/i, "")
    .replace(/\([^)]*\)/, "")
    .replace(/\{[^}]*\}/, "")
    .replace(/〈[^〉]+〉/, "")
    .replace(/\[[^\]]+\]/, "")
    .replace(/#\d+$/, "")
    .trim();
  return { condition_label, card_number, set_code, rarity, name };
}

const isSingle = (p: any) => {
  const x = parseTitle(p?.title ?? "");
  return !!(
    p?.title &&
    x.card_number &&
    x.set_code &&
    !/(PSA|BGS|CGC|オリパ|BOX|パック|スリーブ|デッキ|プレイマット|サプライ|鑑定)/i.test(p.title)
  );
};
const errText = (e: any) => e?.message ? String(e.message) : JSON.stringify(e);

async function proxySecret() {
  const q = await supabase.rpc("get_ha_proxy_secret");
  if (q.error || !q.data) throw new Error("HA proxy secret unavailable");
  return String(q.data);
}

async function sourceConfig() {
  // The production source code is "ha_current"; do not query the obsolete HA_SELL alias.
  const q = await supabase.from("sale_sources").select("id,code,base_url").eq("id", "75d222f1-4e7c-48b2-95ff-8de0f885ebd7").single();
  if (q.error) throw q.error;
  if (!q.data?.base_url) throw new Error("sale source config missing");
  return q.data;
}

function parseCollectionProductsHtml(html: string) {
  const out: any[] = [];
  const seen = new Set<string>();
  const links: { handle: string; pos: number }[] = [];
  const re = /href=["'](?:https?:\/\/[^"']+)?\/products\/([^"'?#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const handle = decodeURIComponent(m[1]);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    links.push({ handle, pos: m.index });
  }
  for (let i = 0; i < links.length; i++) {
    const cur = links[i];
    const end = links[i + 1]?.pos ?? Math.min(html.length, cur.pos + 20000);
    const block = clean(html.slice(cur.pos, end));
    const priceMatch = block.match(/販売価格[:：]\s*[¥￥]\s*([0-9,]+)/);
    if (!priceMatch) continue;
    const price = Number(priceMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(price)) continue;
    const soldOut = /SOLD\s*OUT|在庫なし|売り切れ/i.test(block);
    const stockMatch = block.match(/在庫\s*(\d+)\s*(?:個|点|枚)?/);
    const qty = stockMatch ? Number(stockMatch[1]) : null;
    const body = block.replace(/^href=.*?>\s*/i, "").trim();
    const cardMatch = body.match(/〈[0-9]+\/[0-9]+〉/);
    const dashCardMatch = body.match(/〈-〉/);
    let title = "";
    if (cardMatch || dashCardMatch) {
      const cut = body.search(/\s単価\s*\/\s*あたり/);
      title = (cut >= 0 ? body.slice(0, cut) : body.slice(0, 500)).trim();
    }
    if (!title || !/[〈〉]/.test(title)) continue;
    out.push({
      id: cur.handle,
      handle: cur.handle,
      title,
      available: !soldOut && (qty == null || qty > 0),
      variants: [{
        id: cur.handle,
        available: !soldOut && (qty == null || qty > 0),
        price,
        inventory_quantity: qty == null ? undefined : qty,
      }],
    });
  }
  return { products: out };
}

async function fetchPage(page: number, collection: string, baseUrl: string) {
  const root = baseUrl.replace(/\/$/, "");
  if (collection === "all") {
    const secret = await proxySecret();
    const proxy = "https://profit-checker-api.vercel.app/api/ha-source-proxy?page=" + page + "&collection=all";
    const pr = await fetch(proxy, { headers: { accept: "application/json", "x-ha-proxy-secret": secret } });
    if (pr.ok) return await pr.json();
    if (pr.status === 401) throw new Error("HA proxy unauthorized");
    throw new Error("HA proxy HTTP " + pr.status);
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const r = await fetch(url, {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36",
            "accept-language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
          },
          signal: controller.signal,
        });
        if (r.ok) return parseCollectionProductsHtml(await r.text());
        lastStatus = r.status;
        if (r.status !== 429 && r.status < 500) break;
        if (attempt < 2) await new Promise(r2 => setTimeout(r2, 2000 + Math.floor(Math.random() * 2500)));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error("source HTML HTTP " + lastStatus + " page=" + page);
  }

  const url = root + "/collections/" + collection + "/products.json?limit=250&page=" + page + "&sort_by=created-ascending";
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const r = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "Cross-Border-Seller-Radar/6.4" },
        signal: controller.signal,
      });
      if (r.ok) return await r.json();
      lastStatus = r.status;
      if (r.status !== 429 && r.status < 500) break;
      if (attempt < 2) await new Promise(r2 => setTimeout(r2, 2000 + Math.floor(Math.random() * 2500)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("source HTTP " + lastStatus + " page=" + page);
}

async function loadProducts(nums: string[]) {
  const out: any[] = [];
  for (let i = 0; i < nums.length; i += 100) {
    const q = await supabase.from("market_products").select("id,canonical_name,card_number,set_name,rarity,normalized_key,variant_key,variant_base_name").in("card_number", nums.slice(i, i + 100));
    if (q.error) throw new Error("market product lookup: " + errText(q.error));
    out.push(...(q.data ?? []));
  }
  return out;
}
async function loadAliasMap(nums: string[]) {
  const out: any[] = [];
  for (let i = 0; i < nums.length; i += 100) {
    const q = await supabase.from("cd_ha_set_name_alias_map").select("alias_product_id,canonical_product_id,canonical_set_code,ha_set_name,card_number,rarity").in("card_number", nums.slice(i, i + 100));
    if (q.error) throw new Error("alias map lookup: " + errText(q.error));
    out.push(...(q.data ?? []));
  }
  return out;
}


async function fetchExactStockQty(baseUrl: string, handle: string | null, fallbackAvailable: boolean | null) {
  if (!handle) return { qty: null as number | null, source: null as string | null };
  const root = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  try {
    const jr = await fetch(root + "/products/" + encodeURIComponent(handle) + ".json", {
      headers: { accept: "application/json", "user-agent": "Cross-Border-Seller-Radar/6.2" },
    });
    if (jr.ok) {
      const jd = await jr.json();
      const variants = Array.isArray(jd?.product?.variants) ? jd.product.variants : [];
      if (variants.length) {
        const tracked = variants.filter((v: any) => v?.inventory_management);
        const quantities = tracked.map((v: any) => Number(v.inventory_quantity));
        if (tracked.length === variants.length && quantities.every((n: number) => Number.isInteger(n) && n >= 0)) {
          return { qty: quantities.reduce((a: number, n: number) => a + n, 0), source: "product_json" };
        }
      }
    }
  } catch {}

  try {
    const r = await fetch(root + "/products/" + encodeURIComponent(handle), {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Cross-Border-Seller-Radar/6.2" },
    });
    if (r.ok) {
      const html = await r.text();
      const patterns = [
        /"inventory_quantity"\s*:\s*(-?\d+)/i,
        /inventory[_-]?quantity["']?\s*[:=]\s*["']?(-?\d+)/i,
        /"quantityAvailable"\s*:\s*(\d+)/i,
        /在庫\s*(?:数|数量)\s*[:：]?\s*(\d+)\s*(?:個|点|枚)?/i,
        /在庫\s*(\d+)\s*(?:個|点|枚)?/i,
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m) {
          const n = Number(m[1]);
          if (Number.isInteger(n) && n >= 0) return { qty: n, source: "product_html" };
        }
      }
    }
  } catch {}

  return { qty: fallbackAvailable === false ? 0 : null, source: fallbackAvailable === false ? "availability" : null };
}

async function fetchCollectionStockMap(baseUrl: string, collection: string, page: number) {
  const root = baseUrl.replace(/\/$/, "");
  const url = root + "/collections/" + collection + "?page=" + page + "&sort_by=created-ascending";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Cross-Border-Seller-Radar/6.3" },
      });
      if (!r.ok) {
        if (r.status === 429 || r.status >= 500) {
          await new Promise(r2 => setTimeout(r2, 1500 + Math.floor(Math.random() * 2500)));
          continue;
        }
        return new Map<string, { qty: number; source: string }>();
      }
      const html = await r.text();
            const handles = [...new Set([...html.matchAll(/\/products\/([^"?# \t\r\n<>]+)/g)].map(m => decodeURIComponent(m[1])))];
      const positions = handles.map(handle => ({ handle, pos: html.indexOf("/products/" + handle) })).filter(x => x.pos >= 0).sort((a,b) => a.pos-b.pos);
      const out = new Map<string, { qty: number; source: string }>();
      for (let i = 0; i < positions.length; i++) {
        const cur = positions[i];
        const next = positions.slice(i + 1).find(x => x.handle !== cur.handle);
        const segment = html.slice(cur.pos, next?.pos ?? Math.min(html.length, cur.pos + 18000));
                const noStock = /在庫[ \t]*なし|在庫[ \t]*0[ \t]*(?:個|点|枚)?/i.test(segment);
        if (noStock) {
          out.set(cur.handle, { qty: 0, source: "collection_html" });
          continue;
        }
                const m = segment.match(/(?:在庫|残り|あと)[ 	]*(?:数|数量)?[ 	]*[:：]?[ 	]*(\d+)[ 	]*(?:個|点|枚)?/i) ||
          segment.match(/(?:only|remaining)[ 	]+(\d+)[ 	]*(?:left|in[ 	]*stock)?/i);
        if (m) {
          const qty = Number(m[1]);
          if (Number.isInteger(qty) && qty >= 0) out.set(cur.handle, { qty, source: "collection_html" });
        }
      }
      return out;
    } catch {
      if (attempt === 2) return new Map<string, { qty: number; source: string }>();
      await new Promise(r2 => setTimeout(r2, 1500 + Math.floor(Math.random() * 2500)));
    }
  }
  return new Map<string, { qty: number; source: string }>();
}

async function enrichUnknownStock(rows: any[], baseUrl: string, limit = 50) {
  const unknown = rows.filter(x => x.external_product_key && x.stock_qty == null);
  let prioritized = unknown;
  const ids = [...new Set(unknown.map(x => x.product_id).filter(Boolean))];
  if (ids.length) {
    const cp = await supabase.from("cd_current_stable_prices").select("product_id,price_jpy").in("product_id", ids);
    if (!cp.error) {
      const buy = new Map((cp.data ?? []).map((x: any) => [x.product_id, Number(x.price_jpy)]));
      prioritized = [...unknown].sort((a, b) => {
        const ap = buy.get(a.product_id);
        const bp = buy.get(b.product_id);
        const aa = Number.isFinite(ap) && ap > Number(a.sale_price_jpy ?? 0);
        const bb = Number.isFinite(bp) && bp > Number(b.sale_price_jpy ?? 0);
        return Number(bb) - Number(aa);
      });
    }
  }
  const targets = prioritized.slice(0, limit);
  for (let i = 0; i < targets.length; i += 1) {
    const row = targets[i];
    const handle = row.raw_payload?.handle ? String(row.raw_payload.handle) : null;
    const r = await fetchExactStockQty(baseUrl, handle, row.in_stock);
    if (r.qty != null) {
      row.stock_qty = r.qty;
      row.stock_qty_source = r.source;
      row.stock_qty_observed_at = new Date().toISOString();
      row.raw_payload = { ...(row.raw_payload ?? {}), stock_qty_source: r.source, stock_qty_exact: true };
    }
    if (i + 1 < targets.length) await new Promise(r2 => setTimeout(r2, 450 + Math.floor(Math.random() * 650)));
  }
}

async function refreshStockBatch(limit = 5) {
  const q = await supabase.from("sale_current_opportunities_cd_ha")
    .select("sale_observation_id,canonical_name,card_number")
    .limit(Math.min(20, Math.max(1, limit)));
  if (q.error) throw q.error;
  const ids = (q.data ?? []).map((x: any) => x.sale_observation_id).filter(Boolean);
  if (!ids.length) return { candidates: 0, refreshed: 0, exact: 0 };
  const obs = await supabase.from("sale_observations")
    .select("id,external_product_key,card_number,stock_qty,in_stock,raw_payload")
    .in("id", ids);
  if (obs.error) throw obs.error;
  const source = await sourceConfig();
  const secret = await proxySecret();
  let refreshed = 0, exact = 0;
  const targets = (obs.data ?? []).slice(0, limit);
  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const handle = row.raw_payload?.handle ? String(row.raw_payload.handle) : null;
    let qty: number | null = null;
    let sourceName: string | null = null;
    const product = (q.data ?? []).find((x: any) => x.sale_observation_id === row.id);
    if (row.card_number && product?.canonical_name) {
      try {
        const searchText = [product.canonical_name, row.card_number].filter(Boolean).join(" ");
        const proxyUrl = "https://profit-checker-api.vercel.app/api/ha-source-proxy?search=" + encodeURIComponent(searchText) + "&card_number=" + encodeURIComponent(String(row.card_number));
        const pr = await fetch(proxyUrl, { headers: { accept: "application/json", "x-ha-proxy-secret": secret } });
        if (pr.ok) {
          const pd = await pr.json();
          const match = (pd.matches ?? []).find((x: any) => handle && String(x.handle) === handle);
          if (match && Number.isInteger(Number(match.stock_qty)) && Number(match.stock_qty) >= 0) {
            qty = Number(match.stock_qty);
            sourceName = "search_html";
          }
        }
      } catch {}
    }
    if (qty == null) {
      const r = await fetchExactStockQty(source.base_url, handle, row.in_stock);
      qty = r.qty;
      sourceName = r.source;
    }
    if (qty != null && row.external_product_key) {
      const patch = {
        stock_qty: qty,
        stock_qty_source: sourceName,
        stock_qty_observed_at: new Date().toISOString(),
        raw_payload: { ...(row.raw_payload ?? {}), stock_qty_source: sourceName, stock_qty_exact: sourceName !== "availability" },
      };
      const u = await supabase.from("sale_observations").update(patch).eq("id", row.id);
      if (u.error) throw u.error;
      refreshed++;
      if (sourceName !== "availability") exact++;
    }
    if (i + 1 < targets.length) await new Promise(r => setTimeout(r, 900));
  }
  return { candidates: obs.data?.length ?? 0, refreshed, exact };
}

async function run(b: any) {
  const source = await sourceConfig();
  const pageStart = Math.max(1, Number(b.page_start ?? 1));
  const pageCount = Math.min(8, Math.max(1, Number(b.page_count ?? 1)));
  const collection = String(b.collection ?? "all").replace(/[^a-zA-Z0-9_-]/g, "");
  const rr = await supabase.from("sale_fetch_runs")
    .insert({ sale_source_id: source.id, status: "RUNNING" })
    .select("id").single();
  if (rr.error) throw rr.error;

  let pages = 0, seen = 0, written = 0, opps = 0, singles = 0, stage = "init";
  try {
    const all: any[] = [];
    const allListings: any[] = [];
    for (let p = pageStart; p < pageStart + pageCount; p++) {
      const d = await fetchPage(p, collection, source.base_url);
      if (collection !== "all") {
        const stockMap = await fetchCollectionStockMap(source.base_url, collection, p);
        for (const product of (Array.isArray(d?.products) ? d.products : [])) {
          const handle = product?.handle ? String(product.handle) : null;
          const stock = handle ? stockMap.get(handle) : null;
          if (stock) {
            product.__collection_stock_qty = stock.qty;
            product.__collection_stock_source = stock.source;
          }
        }
      }
      if (p < pageStart + pageCount - 1) {
        await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 1500)));
      }
      const ps = Array.isArray(d?.products) ? d.products : [];
      pages++;
      if (!ps.length) break;
      for (const p0 of ps) {
        seen++;
        allListings.push(p0);
        if (isSingle(p0)) {
          all.push(p0);
          singles++;
        }
      }
      if (collection !== "all" && ps.length < 250) break;
    }

    stage = "load_products";
    const nums = [...new Set(all.map(p => parseTitle(p.title).card_number).filter((v: any) => v && /^\d+\/\d+$/.test(String(v))))] as string[];
    const products = await loadProducts(nums);
    stage = "load_aliases";
    const aliases = await loadAliasMap(nums);
    const productById = new Map(products.map((x: any) => [x.id, x]));
    const aliasToCanonical = new Map(aliases.map((x: any) => [x.alias_product_id, x.canonical_product_id]));
    const normalizedProducts = new Map<string, any>();
    for (const x of products) {
      const canonicalId = aliasToCanonical.get(x.id) ?? x.id;
      const canonical = productById.get(canonicalId) ?? x;
      normalizedProducts.set(canonicalId, canonical);
    }
    const map = new Map<string, any[]>();
    for (const x of normalizedProducts.values()) {
      const k = norm(x.card_number);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(x);
    }
    const allProducts = [...normalizedProducts.values()];

    const nameMatchFor = (candidate: any, sourceName: string) =>
      norm(candidate?.canonical_name ?? "") === norm(sourceName);
    const baseNameMatchFor = (candidate: any, sourceName: string) =>
      norm(candidate?.variant_base_name ?? variantBase(candidate?.canonical_name ?? "")) === norm(variantBase(sourceName));
    stage = "build_rows";
    const rows: any[] = [];
    for (const p of all) {
      const x = parseTitle(p.title);
      const vs = Array.isArray(p.variants) ? p.variants : [];
      const v = vs[0] ?? {};
      const price = Math.round(Number(v.price ?? p.price ?? 0));
      const available = vs.some((z: any) => z.available === true) || p.available === true;
      const exactVariantQty = vs.length > 0 && vs.every((z: any) =>
        z.inventory_quantity !== undefined && z.inventory_quantity !== null &&
        Number.isInteger(Number(z.inventory_quantity)) && Number(z.inventory_quantity) >= 0);
      const qty = exactVariantQty
        ? vs.reduce((n: number, z: any) => n + Number(z.inventory_quantity), 0)
        : 0;
      const exactQty = p.__collection_stock_qty != null || exactVariantQty;
      const hasCardNumber = /^\d+\/\d+$/.test(String(x.card_number ?? ""));
      const sourceCardNumber = clean(x.card_number);
      const baseCandidates = sourceCardNumber
        ? (map.get(norm(sourceCardNumber)) ?? [])
        : allProducts;
      const candidates = baseCandidates.map((candidate: any) => {
        const nameMatch = norm(candidate.canonical_name) === norm(x.name);
        const sourceVariant = variantKey(x.name);
        const candidateVariant = candidate.variant_key ?? variantKey(candidate.canonical_name);
        const variantMatch = sourceVariant === candidateVariant;
        const sourceBase = variantBase(x.name);
        const candidateBase = candidate.variant_base_name ?? variantBase(candidate.canonical_name);
        const baseNameMatch = norm(candidateBase) === norm(sourceBase);
        const rarityMatch = clean(candidate.rarity) === clean(x.rarity);
        const setMatch = !!x.set_code && x.set_code !== "-" &&
          ("|" + norm(candidate.normalized_key ?? "").toLowerCase() + "|").includes("|" + norm(x.set_code).toLowerCase() + "|");
        const score = !variantMatch ? -1 :
          (hasCardNumber ? 60 : 0) +
          (nameMatch ? (hasCardNumber ? 30 : 40) : 0) +
          (baseNameMatch ? 25 : 0) +
          (variantMatch ? 20 : 0) +
          (rarityMatch ? 10 : 0) +
          (setMatch ? (hasCardNumber ? 20 : 30) : 0);
        return { candidate, score };
      });
      const topScore = candidates.reduce((m: number, z: any) => Math.max(m, z.score), 0);
      const top = candidates.filter((z: any) => z.score === topScore);
      const identityNameMatch = top.length === 1 && (nameMatchFor(top[0]?.candidate, x.name) || baseNameMatchFor(top[0]?.candidate, x.name));
      const exactCardIdentity = !sourceCardNumber || clean(top[0]?.candidate?.card_number) === sourceCardNumber;
      const c = exactCardIdentity && identityNameMatch && topScore >= (sourceCardNumber ? 90 : 70) ? top[0].candidate : null;
      rows.push({
        sale_fetch_run_id: rr.data.id,
        sale_source_id: source.id,
        product_id: c?.id ?? null,
        external_product_key: String(p.id ?? p.handle ?? p.title),
        product_name: clean(p.title),
        card_number: x.card_number,
        set_code: x.set_code,
        rarity: x.rarity,
        condition_label: x.condition_label,
        variant_key: variantKey(x.name),
        variant_base_name: variantBase(x.name),
        sale_price_jpy: price,
        stock_qty: p.__collection_stock_qty != null ? Number(p.__collection_stock_qty) : (exactVariantQty ? qty : (available ? null : 0)),
        stock_qty_source: p.__collection_stock_qty != null ? String(p.__collection_stock_source ?? "collection_html") : (exactVariantQty ? "source_json" : (available ? null : "availability")),
        stock_qty_observed_at: (p.__collection_stock_qty != null || exactQty || !available) ? new Date().toISOString() : null,
        in_stock: available,
        source_url: source.base_url.replace(/\/$/, "") + "/products/" + (p.handle ?? p.id),
        observed_at: new Date().toISOString(),
        raw_payload: {
          source_id: p.id,
          handle: p.handle,
          collection,
          stock_qty_source: p.__collection_stock_qty != null ? String(p.__collection_stock_source ?? "collection_html") : (exactVariantQty ? "source_json" : (available ? null : "availability")),
          stock_qty_exact: exactQty,
          variants: vs.map((z: any) => ({
            id: z.id, available: z.available, price: z.price,
            inventory_quantity: z.inventory_quantity, sku: z.sku,
          })),
        },
      });
    }

    stage = "enrich_stock";
    if (collection !== "all") {
      await enrichUnknownStock(rows, source.base_url, 5);
    }

    stage = "insert_observations";
    for (let i = 0; i < rows.length; i += 100) {
      const ins = await supabase.from("sale_observations").insert(rows.slice(i, i + 100));
      if (ins.error) throw new Error("sale observation write: " + errText(ins.error));
      written += Math.min(100, rows.length - i);
    }

    const stagingCycleId = String(b.cycle_id ?? "");
    if (stagingCycleId && allListings.length) {
      const keys = [...new Set(allListings.map((p: any) => String(p?.id ?? p?.handle ?? p?.title ?? "")).filter(Boolean))];
      for (let i = 0; i < keys.length; i += 500) {
        const stg = await supabase.rpc("stage_sale_current_keys", {
          p_sale_source_id: source.id,
          p_cycle_id: stagingCycleId,
          p_external_product_keys: keys.slice(i, i + 500),
        });
        if (stg.error) throw new Error("sale current staging write: " + errText(stg.error));
      }
    }

    // Opportunity derivation is intentionally decoupled from collection.
    // The current opportunity view/API performs the authoritative current-state join.
    await supabase.from("sale_fetch_runs").update({
      finished_at: new Date().toISOString(),
      status: "SUCCESS",
      pages_scanned: pages,
      products_seen: seen,
      observations_written: written,
      opportunities_found: opps,
    }).eq("id", rr.data.id);
    return { ok: true, run_id: rr.data.id, collection, pages_scanned: pages,
      products_seen: seen, single_listings: singles, observations_written: written,
      opportunities_found: opps };
  } catch (e) {
    await supabase.from("sale_fetch_runs").update({
      finished_at: new Date().toISOString(), status: "FAILED",
      pages_scanned: pages, products_seen: seen, error_count: 1, error_message: "stage=" + stage + "; " + errText(e),
    }).eq("id", rr.data.id);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = req.method === "GET"
      ? Object.fromEntries(new URL(req.url).searchParams.entries())
      : await req.json().catch(() => ({}));

    if (b.action === "scheduled") {
      // Never overlap two collection runs. A network call can outlive the scheduler
      // request when the upstream returns a long Retry-After.
      const runningQ = await supabase.from("sale_fetch_runs")
        .select("id,started_at")
        .eq("status","RUNNING")
        .order("started_at",{ascending:false})
        .limit(1)
        .maybeSingle();
      if (runningQ.error) throw runningQ.error;
      if (runningQ.data) {
        const ageMs = Date.now() - new Date(runningQ.data.started_at).getTime();
        if (ageMs < 10 * 60 * 1000) {
          return new Response(JSON.stringify({ ok:true, skipped:true, reason:"run_in_progress" }), { headers: cors });
        }
        await supabase.from("sale_fetch_runs").update({
          finished_at:new Date().toISOString(),
          status:"FAILED",
          error_count:1,
          error_message:"stale RUNNING run recovered by scheduler"
        }).eq("id",runningQ.data.id).eq("status","RUNNING");
      }
      // Recover an abandoned multi-page cycle after a day without a successful run.
      // Preserve the published listing snapshot until a new cycle is finalized.
      const preState = await supabase.from("sale_collection_state")
        .select("last_success_at,cycle_started_at").eq("id", true).single();
      if (preState.error) throw preState.error;
      const lastSuccessMs = preState.data.last_success_at ? Date.parse(preState.data.last_success_at) : 0;
      if (!lastSuccessMs || Date.now() - lastSuccessMs > 24 * 60 * 60 * 1000) {
        const resetAt = new Date().toISOString();
        const reset = await supabase.from("sale_collection_state").update({
          next_page: 1, current_cycle_id: crypto.randomUUID(), cycle_started_at: resetAt,
          next_due_at: resetAt,
        }).eq("id", true);
        if (reset.error) throw reset.error;
      }

      const claim = await supabase.rpc("claim_sale_collection_slot", {
        p_kind: "normal", p_min_minutes: 8, p_max_minutes: 22,
      });
      if (claim.error) throw claim.error;
      if (!claim.data) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "not_due" }), { headers: cors });
      }
      const st = await supabase.from("sale_collection_state")
        .select("next_page,pages_per_run,max_page,current_cycle_id,cycle_started_at").eq("id", true).single();
      if (st.error) throw st.error;
      const start = Math.max(1, Number(st.data.next_page));
      const maxPage = Math.max(1, Number(st.data.max_page));
      // Never request beyond the authoritative final page. The last run may contain fewer pages than pages_per_run.
      const count = Math.max(1, Math.min(5, Number(st.data.pages_per_run), maxPage - start + 1));
      const cycleId = st.data.current_cycle_id ?? crypto.randomUUID();
      const result = await run({ page_start: start, page_count: count, collection: "all", cycle_id: cycleId });
      const wraps = start + count - 1 >= maxPage;
      if (wraps) {
        const fin = await supabase.rpc("finalize_sale_current_cycle", {
          p_sale_source_id: (await sourceConfig()).id,
          p_cycle_id: cycleId, p_min_safe_count: 100,
        });
        if (fin.error) throw fin.error;
      }
      const next = wraps ? 1 : start + count;
      const nextCycleId = wraps ? crypto.randomUUID() : cycleId;
      const nowIso = new Date().toISOString();
      const patch: any = {
        next_page: next, last_run_at: nowIso, last_success_at: nowIso,
        last_run_id: result.run_id, current_cycle_id: nextCycleId,
      };
      if (wraps) {
        patch.cycle_started_at = nowIso;
        patch.last_completed_cycle_id = cycleId;
        patch.last_completed_cycle_at = nowIso;
      }
      const upd = await supabase.from("sale_collection_state").update(patch).eq("id", true);
      if (upd.error) throw upd.error;

      let stock_refresh = { candidates: 0, refreshed: 0, exact: 0 };
      try { stock_refresh = await refreshStockBatch(5); } catch (_) {}

      const damagedClaim = await supabase.rpc("claim_sale_collection_slot", {
        p_kind: "damaged", p_min_minutes: 25, p_max_minutes: 55,
      });
      if (damagedClaim.error) throw damagedClaim.error;
      let damagedScanError: string | null = null;
      if (damagedClaim.data) {
        try {
          await run({ page_start: 1, page_count: 1, collection: "damaged-discount" });
        } catch (e) {
          // A rate-limited optional damaged-listing scan must not fail the normal listing cycle.
          damagedScanError = errText(e);
        }
      }
      return new Response(JSON.stringify({ ...result, damaged_scan: !!damagedClaim.data, damaged_scan_error: damagedScanError }), { headers: cors });
    }

    if (b.action === "run") return new Response(JSON.stringify(await run(b)), { headers: cors });

    if (b.action === "probe") {
      const source = await sourceConfig();
      const d = await fetchPage(1, String(b.collection ?? "all"), source.base_url);
      return new Response(JSON.stringify({
        ok: true, collection: String(b.collection ?? "all"),
        product_count: Array.isArray(d?.products) ? d.products.length : 0,
        first: d?.products?.[0]?.title ?? null,
      }), { headers: cors });
    }

    if (b.action === "health") {
      const q = await supabase.from("sale_collection_health_cd_ha").select("*").single();
      if (q.error) throw q.error;
      return new Response(JSON.stringify({ ok: true, health: q.data }), { headers: cors });
    }

    if (b.action === "match_review") {
      const q = await supabase.from("sale_match_review_cd_ha")
        .select("id,condition_label,product_name,sale_price_jpy,card_number,set_code,rarity,sale_name,card_number_candidates,exact_name_set_rarity_candidates,all_candidates,review_status,observed_at")
        .order("observed_at", { ascending: false })
        .limit(Math.min(500, Math.max(1, Number(b.limit ?? 100))));
      if (q.error) throw q.error;
      return new Response(JSON.stringify({ ok: true, count: q.data?.length ?? 0, review: q.data ?? [] }), { headers: cors });
    }

    if (b.action === "refresh_opportunity_stock") {
      const q = await supabase.from("sale_current_opportunities_cd_ha")
        .select("sale_observation_id,canonical_name,card_number")
        .limit(200);
      if (q.error) throw q.error;
      const ids = (q.data ?? []).map((x: any) => x.sale_observation_id).filter(Boolean);
      const obs = ids.length
        ? await supabase.from("sale_observations").select("id,external_product_key,card_number,stock_qty,stock_qty_source,in_stock,raw_payload").in("id", ids)
        : { data: [], error: null };
      if (obs.error) throw obs.error;
      const source = await sourceConfig();
      const proxySecretValue = await proxySecret();
      const results: any[] = [];
      for (const row of (obs.data ?? [])) {
        const handle = row.raw_payload?.handle ? String(row.raw_payload.handle) : null;
        let result = { qty: row.in_stock === false ? 0 : null, source: row.in_stock === false ? "availability" : null as string | null };
        if (row.card_number) {
          try {
            const searchText = [row.canonical_name, row.card_number].filter(Boolean).join(" ");
            const proxyUrl = "https://profit-checker-api.vercel.app/api/ha-source-proxy?search=" + encodeURIComponent(searchText) + "&card_number=" + encodeURIComponent(String(row.card_number));
            const pr = await fetch(proxyUrl, { headers: { accept: "application/json", "x-ha-proxy-secret": proxySecretValue } });
            if (pr.ok) {
              const pd = await pr.json();
              const match = (pd.matches ?? []).find((x: any) => handle && String(x.handle) === handle);
              if (match && Number.isInteger(Number(match.stock_qty)) && Number(match.stock_qty) >= 0) {
                result = { qty: Number(match.stock_qty), source: "search_html" };
              }
            }
          } catch {}
        }
        if (result.qty == null) {
          result = await fetchExactStockQty(source.base_url, handle, row.in_stock);
        }
        results.push({ row, result });
      }
      const updates = results.filter(x => x.row.external_product_key && x.result.qty != null);
      await Promise.all(updates.map(async ({ row, result }) => {
        const patch = {
          stock_qty: result.qty,
          stock_qty_source: result.source,
          stock_qty_observed_at: new Date().toISOString(),
          raw_payload: { ...(row.raw_payload ?? {}), stock_qty_source: result.source, stock_qty_exact: true },
        };
        const u = await supabase.from("sale_observations").update(patch).eq("id", row.id);
        if (u.error) throw u.error;
      }));
      return new Response(JSON.stringify({
        ok: true,
        candidates: obs.data?.length ?? 0,
        refreshed: updates.length,
        exact: updates.filter(x => x.result.source !== "availability").length,
      }), { headers: cors });
    }

    if (b.action === "opportunities") {
      const q = await supabase.from("sale_current_opportunities_cd_ha")
        .select("sale_observation_id,product_id,canonical_name,set_name,card_number,rarity,product_name,condition_label,condition_group,is_primary_condition,sale_price_jpy,stock_qty,stock_qty_source,stock_qty_observed_at,sale_observed_at,cd_buy_price_jpy,cd_buy_observed_at,gross_spread_jpy,gross_margin_pct,variant_key,variant_base_name").order("gross_spread_jpy", { ascending: false })
        .limit(Math.min(200, Math.max(1, Number(b.limit ?? 50))));
      if (q.error) throw q.error;
      return new Response(JSON.stringify({ ok: true, count: q.data?.length ?? 0, opportunities: q.data ?? [] }), { headers: cors });
    }

    if (b.action === "comparison") {
      const q = await supabase.from("sale_condition_comparison_cd_ha")
        .select("*").order("a_spread_jpy", { ascending: false, nullsFirst: false })
        .limit(Math.min(200, Math.max(1, Number(b.limit ?? 100))));
      if (q.error) throw q.error;
      return new Response(JSON.stringify({ ok: true, count: q.data?.length ?? 0, comparison: q.data ?? [] }), { headers: cors });
    }

    return new Response(JSON.stringify({ ok: false, error: "unknown action" }),
      { status: 400, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: errText(e) }),
      { status: 500, headers: cors });
  }
});