import { NextResponse } from "next/server";

const url = process.env.SUPABASE_URL || "https://whkxkdxpndajqkkqmrcu.supabase.co";
const key = process.env.SUPABASE_PUBLISHABLE_KEY || "";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ ok: false, error: "server configuration unavailable" }, { status: 500 });
  }

  const endpoint = new URL("/functions/v1/sale-source-url", url);
  endpoint.searchParams.set("id", id);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json({ ok: false, error: "lookup failed" }, { status: 502 });
  }

  const payload = await response.json();
  const target = payload?.url;
  if (!payload?.ok || !/^https?:\/\//i.test(String(target ?? ""))) {
    return NextResponse.json({ ok: false, error: "target unavailable" }, { status: 404 });
  }

  return NextResponse.redirect(String(target), 302);
}
