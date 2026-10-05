import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HA_SOURCE_ID = "75d222f1-4e7c-48b2-95ff-8de0f885ebd7";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function db(path: string) {
  const r = await fetch(SUPABASE_URL + path, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) throw new Error(`database request failed: ${r.status}`);
  return r.json();
}

Deno.serve(async (req: Request) => {
  try {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: "invalid id" }, 400);

    const state = await db("/rest/v1/sale_collection_state?select=last_completed_cycle_id&id=eq.true&limit=1");
    const cycleId = state?.[0]?.last_completed_cycle_id;
    if (!cycleId) return json({ ok: false, error: "current snapshot unavailable" }, 503);

    const obs = await db("/rest/v1/sale_observations?select=external_product_key,source_url,sale_source_id&id=eq." + encodeURIComponent(id) + "&sale_source_id=eq." + HA_SOURCE_ID + "&limit=1");
    const row = obs?.[0];
    if (!row?.external_product_key || !/^https?:\/\//i.test(String(row.source_url ?? ""))) return json({ ok: false, error: "target unavailable" }, 404);

    const listing = await db("/rest/v1/sale_current_listings?select=external_product_key&sale_source_id=eq." + HA_SOURCE_ID + "&cycle_id=eq." + encodeURIComponent(cycleId) + "&external_product_key=eq." + encodeURIComponent(row.external_product_key) + "&limit=1");
    if (!listing?.length) return json({ ok: false, error: "target unavailable" }, 404);

    return json({ ok: true, url: row.source_url });
  } catch {
    return json({ ok: false, error: "lookup failed" }, 502);
  }
});
