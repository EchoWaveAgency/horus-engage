import "server-only";
import { adminClient } from "@/lib/server/admin";
import { mediaStep, menu, step, type Ctx, type Event, type Faq, type Result, type Service, type Settings, type State } from "@/lib/engine/bot";
import { planComment, type CommentSettings } from "@/lib/engine/comments";
import { historyBody, plain, render } from "@/lib/engine/render";
import type { MetaEvent } from "@/lib/meta/parse";
import { hideComment, privateReply, replyToComment, sendMessenger, sendWhatsApp } from "@/lib/meta/graph";
import { commentHint, messageHint } from "@/lib/ai";

// Runs the product: every inbound event is stored first (idempotent), then the bot answers from the client's approved
// content, atomically (version check), then the answer is sent and each result recorded. Service role, svc_* only.

type Db = ReturnType<typeof adminClient>;
type Ingest = { action: string; org_id: string; conversation_id: string; version: number; status: string; bot_state: State;
  channel: { id: string; kind: "whatsapp" | "messenger" | "instagram"; external_id: string };
  contact: { id: string; name: string | null; phone: string | null; lang: "ar" | "en"; external_id: string }; referral: Record<string, string> | null };
type Org = { timezone: string; settings: Settings & CommentSettings & { enabled: boolean; ai_enabled: boolean; hours_from: string | null; hours_to: string | null; private_message_ar: string; private_message_en: string };
  services: Service[]; faqs: Faq[] };

async function loadOrg(db: Db, orgId: string): Promise<Org> {
  const [{ data: org }, { data: settings }, { data: services }, { data: faqs }] = await Promise.all([
    db.from("orgs").select("timezone").eq("id", orgId).single(),
    db.from("bot_settings").select("*").eq("org_id", orgId).single(),
    db.from("services").select("id, code, name_ar, name_en, summary_ar, summary_en, offer_ar, offer_en, price_ar, price_en, duration_ar, duration_en, booking_mode, keywords, campaign_codes, filter_question_ar, filter_question_en, filter_options")
      .eq("org_id", orgId).eq("is_active", true).order("sort").order("code"),
    db.from("faqs").select("question_ar, question_en, answer_ar, answer_en, keywords, handoff, service:services(code)").eq("org_id", orgId).eq("is_active", true),
  ]);
  return {
    timezone: org?.timezone ?? "Africa/Cairo",
    settings: settings as Org["settings"],
    services: (services ?? []) as Service[],
    faqs: ((faqs ?? []) as unknown as (Faq & { service: { code: string } | null })[]).map((f) => ({ ...f, service_code: f.service?.code ?? null })),
  };
}

export function localToday(tz: string, now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: tz });
}
export function inHours(tz: string, from: string | null, to: string | null, now = new Date()) {
  if (!from || !to) return true;
  const hm = now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  return from <= to ? hm >= from.slice(0, 5) && hm < to.slice(0, 5) : hm >= from.slice(0, 5) || hm < to.slice(0, 5);
}

async function token(db: Db, channelId: string) {
  const { data } = await db.from("channel_secrets").select("access_token").eq("channel_id", channelId).maybeSingle();
  return data?.access_token ?? "";
}

/** Sends queued outgoing messages of a step and records each result. */
async function deliver(db: Db, ch: Ingest["channel"], to: string, ids: number[], outs: Result["say"]) {
  const tk = await token(db, ch.id);
  for (let i = 0; i < ids.length; i++) {
    const payload = render(ch.kind, outs[i]);
    const r = ch.kind === "whatsapp" ? await sendWhatsApp(ch.external_id, tk, to, payload) : await sendMessenger(ch.external_id, tk, to, payload);
    await db.rpc("svc_message_result", { p_id: ids[i], p_ok: r.ok, p_provider_id: r.id ?? null, p_error: r.error ?? null });
  }
}

function payloadOf(r: Result) {
  return {
    state: r.state, status: r.status, handoff_reason: r.handoffReason ?? null, service_code: r.serviceCode ?? null, campaign_code: r.campaignCode ?? null,
    contact: r.contact ?? null, booking: r.booking ?? null,
    messages: r.say.map((o) => ({ kind: o.kind, body: historyBody(o), payload: o.kind === "text" ? null : o })),
  };
}

export async function handleMessage(ev: Extract<MetaEvent, { type: "message" }>) {
  const db = adminClient();
  const { data, error } = await db.rpc("svc_ingest_message", { p: {
    channel_kind: ev.channelKind, channel_external_id: ev.channelExternalId, contact_external_id: ev.contactExternalId, name: ev.name,
    username: ev.username, text: ev.text || (ev.kind === "audio" ? "[رسالة صوتية / voice note]" : ev.kind === "media" ? "[صورة أو ملف / image or file]" : ""),
    kind: ev.kind, payload: ev.buttonId ? { button: ev.buttonId } : null, provider_id: ev.providerId, at: ev.at, referral: ev.referral,
  } });
  if (error) throw Object.assign(new Error(error.message), { stored: false });
  const g = data as Ingest;
  if (!["new_conversation", "message"].includes(g.action)) return { handled: g.action };
  if (g.status !== "bot") return { handled: "with_agent" };   // a person has it: the bot stays quiet

  const org = await loadOrg(db, g.org_id);
  if (!org.settings.enabled) return { handled: "bot_off" };
  const ctx: Ctx = {
    channel: g.channel.kind, contact: { name: g.contact.name, phone: g.contact.phone, lang: g.contact.lang },
    services: org.services, faqs: org.faqs, settings: org.settings, today: localToday(org.timezone),
    inHours: inHours(org.timezone, org.settings.hours_from, org.settings.hours_to),
    referralText: g.referral ? [g.referral.headline, g.referral.body, g.referral.ref].filter(Boolean).join(" ") : null,
  };
  const event: Event = ev.buttonId ? { type: "button", id: ev.buttonId, title: ev.text } : { type: "text", text: ev.text };
  const state = g.bot_state ?? {};
  let r = ev.kind !== "text" && !ev.buttonId ? mediaStep(ctx, state) : step(ctx, state, event);
  if (r.understood === false && event.type === "text" && org.settings.ai_enabled) {
    const hint = await messageHint(event.text, org.services, org.faqs);
    if (hint) r = step({ ...ctx, hint }, state, event);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: applied, error: e } = await db.rpc("svc_bot_apply", { p_conv: g.conversation_id, p_version: g.version, p: payloadOf(r) });
    if (e) {
      if (e.code === "40001") return { handled: "superseded" };   // another message / a person moved the conversation on
      throw new Error(e.message);
    }
    await deliver(db, g.channel, g.contact.external_id, ((applied as { message_ids: number[] }).message_ids ?? []), r.say);
    return { handled: r.status === "human" ? "handoff" : r.booking ? "booking" : "answered", reason: r.handoffReason, usedAi: r.usedAi ?? false };
  }
  return { handled: "superseded" };
}

export async function handleEcho(ev: Extract<MetaEvent, { type: "echo" }>) {
  const { data } = await adminClient().rpc("svc_ingest_echo", { p: {
    channel_kind: ev.channelKind, channel_external_id: ev.channelExternalId, contact_external_id: ev.contactExternalId, text: ev.text, provider_id: ev.providerId } });
  return data;
}

export async function handleComment(ev: Extract<MetaEvent, { type: "comment" }>) {
  const db = adminClient();
  const { data, error } = await db.rpc("svc_ingest_comment", { p: {
    platform: ev.platform, channel_external_id: ev.channelExternalId, comment_id: ev.commentId, post_id: ev.postId, parent_id: ev.parentId,
    author_id: ev.authorId, author_name: ev.authorName, text: ev.text, at: ev.at } });
  if (error) throw Object.assign(new Error(error.message), { stored: false });
  const g = data as { action: string; comment_id: string; org_id: string; channel: Ingest["channel"] };
  if (g.action !== "new") return { handled: g.action };

  const org = await loadOrg(db, g.org_id);
  const s = org.settings;
  const ageDays = ev.at ? (Date.now() - new Date(ev.at).getTime()) / 86400_000 : 0;
  let plan = planComment(ev.text, ev.commentId, s, { isReply: Boolean(ev.parentId), ageDays });
  if (plan.classification === "other" && s.ai_enabled && ev.text.trim()) {
    const hint = await commentHint(ev.text);
    if (hint) plan = planComment(ev.text, ev.commentId, s, { isReply: Boolean(ev.parentId), ageDays, hint });
  }
  const tk = await token(db, g.channel.id);
  const actions: string[] = [];
  const result: Record<string, unknown> = { classification: plan.classification, status: plan.status };

  if (plan.hide) {
    const h = await hideComment(ev.platform, tk, ev.commentId);
    actions.push(h.ok ? "hidden" : `hide failed: ${h.error}`);
    if (h.ok) result.hidden = true; else result.status = "needs_human";
  }
  if (plan.privateReply) {
    const en = /[a-z]{3,}/i.test(ev.text) && !/[؀-ۿ]/.test(ev.text);
    const first = (ev.authorName ?? "").split(" ")[0] || (en ? "there" : "");
    const text = plan.privateMode === "complaint"
      ? (en ? s.comment_complaint_en : s.comment_complaint_ar)
      : plain(menu({ channel: g.channel.kind, contact: {}, services: org.services, faqs: [], settings: s, today: "", inHours: true }, en ? "en" : "ar",
          (en ? s.private_message_en : s.private_message_ar).replace("{name}", first)));
    const p = await privateReply(g.channel.external_id, tk, ev.commentId, text);
    actions.push(p.ok ? `private reply (${plan.privateMode})` : `private reply failed: ${p.error}`);
    if (p.ok) {
      result.private_reply = true;
      if (p.recipientId) {
        const { data: convId } = await db.rpc("svc_comment_conversation", { p_comment: g.comment_id, p_contact_external_id: p.recipientId,
          p_state: { step: plan.privateMode === "complaint" ? "start" : "menu", lang: en ? "en" : "ar" }, p_body: text, p_provider_id: p.id ?? null });
        result.conversation_id = convId;
        if (plan.privateMode === "complaint" && convId) {
          const { data: c } = await db.from("conversations").select("version").eq("id", convId).single();
          await db.rpc("svc_bot_apply", { p_conv: convId, p_version: c?.version ?? 0, p: { status: "human", handoff_reason: "complaint", messages: [] } });
        }
      }
    } else if (plan.status === "auto_handled") result.status = "needs_human";
  }
  if (plan.publicReply && (!plan.privateReply || result.private_reply)) {
    const r = await replyToComment(ev.platform, tk, ev.commentId, plan.publicReply);
    actions.push(r.ok ? "public reply" : `public reply failed: ${r.error}`);
    if (r.ok) { result.public_reply = plan.publicReply; result.public_reply_id = r.id; }
  }
  result.action = actions.length ? actions.join(" · ") : `classified ${plan.classification}`;
  await db.rpc("svc_comment_result", { p_comment: g.comment_id, p: result });
  return { handled: plan.classification, status: result.status };
}

/** Sends a reply an agent's own session has just logged (conv_log_reply checked their membership). */
export async function sendAgentReply(messageId: number, conversationId: string, body: string) {
  const db = adminClient();
  const { data: c } = await db.from("conversations").select("channel_id, contact_id, channels(kind, external_id)").eq("id", conversationId).single();
  const ch = (c as unknown as { channels: { kind: Ingest["channel"]["kind"]; external_id: string } }).channels;
  const { data: idn } = await db.from("contact_identities").select("external_id").eq("contact_id", c!.contact_id).eq("channel_kind", ch.kind).limit(1).single();
  const tk = await token(db, c!.channel_id);
  const out = { kind: "text" as const, body };
  const r = ch.kind === "whatsapp" ? await sendWhatsApp(ch.external_id, tk, idn!.external_id, render("whatsapp", out))
    : await sendMessenger(ch.external_id, tk, idn!.external_id, render(ch.kind, out));
  await db.rpc("svc_message_result", { p_id: messageId, p_ok: r.ok, p_provider_id: r.id ?? null, p_error: r.error ?? null });
  return r;
}

/** Applies a person's comment action on Meta (hide / unhide / public reply). */
export async function commentOnMeta(commentId: string, action: "hide" | "unhide" | "reply", text?: string) {
  const db = adminClient();
  const { data: cm } = await db.from("comments").select("external_id, platform, channel_id").eq("id", commentId).single();
  const tk = await token(db, cm!.channel_id);
  if (action === "reply") return replyToComment(cm!.platform, tk, cm!.external_id, text ?? "");
  return hideComment(cm!.platform, tk, cm!.external_id, action === "hide");
}
