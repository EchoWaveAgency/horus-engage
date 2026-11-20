import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { deliverEvents } from "@/lib/integration";

export const dynamic = "force-dynamic";

// Called every minute by a scheduler (Vercel Cron / Supabase cron) with "Authorization: Bearer <CRON_SECRET>".
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ events: await deliverEvents() }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 }); }
}
export const GET = POST;
