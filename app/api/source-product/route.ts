import { NextResponse } from "next/server";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  const endpoint = new URL("/rest/v1/sale_observations", url);
  endpoint.searchParams.set("id", "eq." + id);
  endpoint.searchParams.set("select", "source_url");
  const r = await fetch(endpoint, {
    headers: { apikey: key, Authorization: "Bearer " + key },
    cache: "no-store",
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: "lookup failed" }, { status: 502 });
  const rows = await r.json();
  const target = rows?.[0]?.source_url;
  if (!target || !/^https?:\/\//i.test(target)) {
    return NextResponse.json({ ok: false, error: "target unavailable" }, { status: 404 });
  }
  return NextResponse.redirect(target, 302);
}