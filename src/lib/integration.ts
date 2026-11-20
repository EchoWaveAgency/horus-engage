import "server-only";
import { createHmac } from "node:crypto";
import { adminClient } from "@/lib/server/admin";

// Delivers lead / booking-request / handoff events to each client's own system (e.g. Golden Care OS call center).
// Body is signed: X-Engage-Signature: sha256=HMAC(secret, body). Retries with back-off; a 2xx JSON {"ref": "..."} is
// stored as the booking's external reference.
type Row = { id: number; org_id: string; event: string; payload: Record<string, unknown> };

export function sign(secret: string, body: string) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export async function deliverEvents(limit = 20) {
  const db = adminClient();
  const { data, error } = await db.rpc("svc_outbox_claim", { p_limit: limit });
  if (error) throw new Error(error.message);
  let sent = 0, failed = 0;
  for (const row of (data ?? []) as Row[]) {
    const [{ data: s }, { data: sec }] = await Promise.all([
      db.from("bot_settings").select("integration_url").eq("org_id", row.org_id).single(),
      db.from("org_secrets").select("integration_secret").eq("org_id", row.org_id).single(),
    ]);
    if (!s?.integration_url || !sec?.integration_secret) {
      await db.rpc("svc_outbox_result", { p_id: row.id, p_ok: false, p_error: "no integration configured" }); failed++; continue;
    }
    const body = JSON.stringify(row.payload);
    try {
      const res = await fetch(s.integration_url, { method: "POST", body, signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "X-Engage-Event": row.event, "X-Engage-Signature": sign(sec.integration_secret, body) } });
      const j = (await res.json().catch(() => ({}))) as { ref?: string; error?: string };
      await db.rpc("svc_outbox_result", { p_id: row.id, p_ok: res.ok, p_error: res.ok ? null : j.error ?? `HTTP ${res.status}`, p_external_ref: j.ref ?? null });
      if (res.ok) sent++; else failed++;
    } catch (e) {
      await db.rpc("svc_outbox_result", { p_id: row.id, p_ok: false, p_error: e instanceof Error ? e.message : "network error" }); failed++;
    }
  }
  return { claimed: (data ?? []).length, sent, failed };
}
