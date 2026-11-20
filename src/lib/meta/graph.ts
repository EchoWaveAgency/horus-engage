import "server-only";
import { randomUUID } from "node:crypto";

// Meta Graph API calls. META_MODE=dev logs instead of calling Meta (local development and end-to-end tests only).
export type SendResult = { ok: boolean; id?: string; recipientId?: string; error?: string };
const version = () => process.env.META_API_VERSION ?? "v21.0";
export const metaMode = () => (process.env.META_MODE === "dev" ? "dev" : "live");
export const devLog: { path: string; body: unknown }[] = [];

async function post(path: string, token: string, body: Record<string, unknown>): Promise<SendResult & { json?: Record<string, unknown> }> {
  if (metaMode() === "dev") {
    devLog.push({ path, body });
    console.info(`[meta:dev] POST ${path} ${JSON.stringify(body).slice(0, 300)}`);
    const rid = typeof (body.recipient as { comment_id?: string } | undefined)?.comment_id === "string" ? `PSID-from-${(body.recipient as { comment_id: string }).comment_id}` : undefined;
    return { ok: true, id: `dev.${randomUUID()}`, recipientId: rid };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${version()}/${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
    if (!res.ok || json.error) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
    const msgs = json.messages as { id: string }[] | undefined;
    return { ok: true, id: (msgs?.[0]?.id ?? json.message_id ?? json.id) as string | undefined, recipientId: json.recipient_id as string | undefined, json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/** WhatsApp Cloud API: `payload` from render.whatsapp(). */
export function sendWhatsApp(phoneNumberId: string, token: string, to: string, payload: Record<string, unknown>) {
  return post(`${phoneNumberId}/messages`, token, { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/[^0-9]/g, ""), ...payload });
}
/** Messenger / Instagram Send API (page token). `message` from render.messenger(). */
export function sendMessenger(accountId: string, token: string, recipientId: string, message: Record<string, unknown>) {
  return post(`${accountId}/messages`, token, { recipient: { id: recipientId }, messaging_type: "RESPONSE", message });
}
/** Private reply to a comment: one DM per comment, within 7 days (Facebook and Instagram). */
export function privateReply(accountId: string, token: string, commentId: string, text: string) {
  return post(`${accountId}/messages`, token, { recipient: { comment_id: commentId }, message: { text } });
}
/** Public reply under the comment. */
export function replyToComment(platform: "facebook" | "instagram", token: string, commentId: string, text: string) {
  return post(platform === "facebook" ? `${commentId}/comments` : `${commentId}/replies`, token, { message: text });
}
export function hideComment(platform: "facebook" | "instagram", token: string, commentId: string, hidden = true) {
  return post(commentId, token, platform === "facebook" ? { is_hidden: hidden } : { hide: hidden });
}
