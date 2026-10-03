export const dynamic = "force-dynamic";
export const revalidate = 0;
import {NextResponse} from "next/server";

const RADAR_API_URL = "https://whkxkdxpndajqkkqmrcu.supabase.co/functions/v1/radar-api";

export async function GET(req:Request){
  const u=new URL(req.url);
  const target=new URL(RADAR_API_URL);
  u.searchParams.forEach((v,k)=>target.searchParams.set(k,v));
  const r=await fetch(target.toString(),{cache:"no-store"});
  const body=await r.json();
  return NextResponse.json(body,{status:r.status});
}
