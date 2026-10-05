import { NextResponse } from "next/server";

const url = process.env.SUPABASE_URL || "https://whkxkdxpndajqkkqmrcu.supabase.co";
const key = process.env.SUPABASE_PUBLISHABLE_KEY || "";
// Uses the publishable key only; privileged database access is intentionally not exposed here.

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ ok: false, error: "server configuration unavailable" }, { status: 500 });
  }

  const endpoint = new URL("/rest/v1/rpc/get_sale_source_url_by_id", url);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_id: id }),
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json({ ok: false, error: "lookup failed" }, { status: 502 });
  }

  const target = await response.json();
  if (!target || !/^https?:\/\//i.test(String(target))) {
    return NextResponse.json({ ok: false, error: "target unavailable" }, { status: 404 });
  }

  return NextResponse.redirect(String(target), 302);
}
