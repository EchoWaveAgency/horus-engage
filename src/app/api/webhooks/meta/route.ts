import { NextResponse } from "next/server";
import { deliverEvents } from "@/lib/integration";
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseMetaWebhook, type MetaEvent } from "@/lib/meta/parse";
import { adminClient } from "@/lib/server/admin";
import { handleComment, handleEcho, handleMessage } from "@/lib/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// One webhook for the Meta app: WhatsApp, Messenger, Instagram DMs, page and Instagram comments, for every client.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = process.env.META_VERIFY_TOKEN;
  if (u.searchParams.get("hub.mode") === "subscribe" && token && u.searchParams.get("hub.verify_token") === token) {
    return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.META_APP_SECRET;
  if (!secret) return new NextResponse("not configured", { status: 503 });
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse("bad signature", { status: 401 });

  let events: MetaEvent[];
  try { events = parseMetaWebhook(raw); } catch { return new NextResponse("bad request", { status: 400 }); }

  const results: unknown[] = [];
  let unstored = 0;
  const db = events.some((e) => e.type === "status") ? adminClient() : null;
  for (const ev of events) {
    try {
      if (ev.type === "status") {
        if (["delivered", "read", "failed"].includes(ev.status)) await db!.rpc("svc_message_status", { p_provider_id: ev.providerId, p_status: ev.status });
      } else if (ev.type === "message") results.push(await handleMessage(ev));
      else if (ev.type === "echo") results.push(await handleEcho(ev));
      else if (ev.type === "comment") results.push(await handleComment(ev));
    } catch (e) {
      // Stored-or-not matters: if the event never reached the database, ask Meta to deliver again (ingest ignores repeats).
      if ((e as { stored?: boolean }).stored === false) unstored++;
      console.error(`[engage] ${ev.type}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (unstored) return NextResponse.json({ error: "retry" }, { status: 503 });
  // Hand new lead / booking / handoff events to the client's system right away (the scheduled job is only a backstop:
  // Vercel Hobby runs it once a day). Best effort — a failure stays queued with back-off.
  if (events.some((e) => e.type !== "status")) {
    try { await deliverEvents(5); } catch (e) { console.error(`[engage] deliver: ${e instanceof Error ? e.message : e}`); }
  }
  return NextResponse.json({ received: events.length, results });
}
