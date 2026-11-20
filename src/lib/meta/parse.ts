// One parser for every Meta webhook this product receives. Pure; unit-tested.
//   object "whatsapp_business_account" — WhatsApp Cloud API messages and delivery statuses
//   object "page"      — Messenger messages (entry.messaging) and Facebook page comments (entry.changes, field "feed")
//   object "instagram" — Instagram DMs (entry.messaging) and comments (entry.changes, field "comments")

export type ChannelKind = "whatsapp" | "messenger" | "instagram";
export type Referral = Record<string, string>;
export type MetaEvent =
  | { type: "message"; channelKind: ChannelKind; channelExternalId: string; contactExternalId: string; name: string | null; username: string | null;
      text: string; kind: "text" | "media" | "audio"; buttonId: string | null; providerId: string; at: string | null; referral: Referral | null }
  | { type: "echo"; channelKind: ChannelKind; channelExternalId: string; contactExternalId: string; text: string; providerId: string }
  | { type: "status"; providerId: string; status: string }
  | { type: "comment"; platform: "facebook" | "instagram"; channelExternalId: string; commentId: string; postId: string | null; parentId: string | null;
      authorId: string | null; authorName: string | null; text: string; at: string | null };

const REF_KEYS = ["source_url", "source_id", "source_type", "headline", "body", "media_type", "ctwa_clid", "ref", "ad_id", "type", "source"];
function referralOf(r: unknown): Referral | null {
  if (!r || typeof r !== "object") return null;
  const out: Referral = {};
  for (const k of REF_KEYS) { const v = (r as Record<string, unknown>)[k]; if (typeof v === "string" && v) out[k] = v.slice(0, 1000); }
  const ads = (r as { ads_context_data?: { ad_title?: string } }).ads_context_data;
  if (ads?.ad_title) out.headline = ads.ad_title.slice(0, 1000);
  return Object.keys(out).length ? out : null;
}
const secs = (t: unknown) => (typeof t === "string" && /^\d{9,11}$/.test(t) ? new Date(Number(t) * 1000).toISOString()
  : typeof t === "number" ? new Date(t > 1e12 ? t : t * 1000).toISOString() : null);

// eslint-disable-next-line
type Any = Record<string, any>;

export function parseMetaWebhook(raw: string): MetaEvent[] {
  const body = JSON.parse(raw) as Any;
  const out: MetaEvent[] = [];
  for (const entry of (body.entry ?? []) as Any[]) {
    if (body.object === "whatsapp_business_account") {
      for (const ch of (entry.changes ?? []) as Any[]) {
        const v = ch.value ?? {};
        const pnid = v.metadata?.phone_number_id;
        const names = new Map<string, string>(((v.contacts ?? []) as Any[]).filter((c) => c.wa_id && c.profile?.name).map((c) => [c.wa_id, c.profile.name]));
        for (const s of (v.statuses ?? []) as Any[]) if (s.id && s.status) out.push({ type: "status", providerId: s.id, status: s.status });
        for (const m of (v.messages ?? []) as Any[]) {
          if (!pnid || !m.from || !m.id) continue;
          const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
          const media = ["image", "document", "video", "sticker"].includes(m.type);
          const audio = m.type === "audio" || m.type === "voice";
          out.push({ type: "message", channelKind: "whatsapp", channelExternalId: pnid, contactExternalId: m.from, name: names.get(m.from) ?? null, username: null,
            text: m.text?.body ?? reply?.title ?? m.button?.text ?? m.image?.caption ?? m.document?.caption ?? m.video?.caption ?? "",
            kind: audio ? "audio" : media ? "media" : "text", buttonId: reply?.id ?? m.button?.payload ?? null, providerId: m.id, at: secs(m.timestamp),
            referral: referralOf(m.referral) });
        }
      }
      continue;
    }
    if (body.object !== "page" && body.object !== "instagram") continue;
    const kind: ChannelKind = body.object === "page" ? "messenger" : "instagram";
    const own = String(entry.id ?? "");
    for (const ev of (entry.messaging ?? []) as Any[]) {
      const msg = ev.message, pb = ev.postback;
      const sender = String(ev.sender?.id ?? ""), recipient = String(ev.recipient?.id ?? "");
      if (msg?.is_echo) {
        if (msg.mid && recipient) out.push({ type: "echo", channelKind: kind, channelExternalId: own || sender, contactExternalId: recipient, text: msg.text ?? "", providerId: msg.mid });
        continue;
      }
      if (!sender || sender === own) continue;
      if (msg && (msg.mid)) {
        if (msg.is_deleted || msg.is_unsupported) continue;
        const att = ((msg.attachments ?? []) as Any[])[0];
        out.push({ type: "message", channelKind: kind, channelExternalId: own || recipient, contactExternalId: sender, name: null, username: null,
          text: msg.quick_reply ? (msg.text ?? "") : msg.text ?? "", kind: att ? (att.type === "audio" ? "audio" : "media") : "text",
          buttonId: msg.quick_reply?.payload ?? null, providerId: msg.mid, at: secs(ev.timestamp), referral: referralOf(msg.referral ?? ev.referral) });
      } else if (pb) {
        out.push({ type: "message", channelKind: kind, channelExternalId: own || recipient, contactExternalId: sender, name: null, username: null,
          text: pb.title ?? "", kind: "text", buttonId: pb.payload ?? null, providerId: pb.mid ?? `pb:${sender}:${ev.timestamp}`, at: secs(ev.timestamp),
          referral: referralOf(pb.referral) });
      }
    }
    for (const ch of (entry.changes ?? []) as Any[]) {
      const v = ch.value ?? {};
      if (kind === "messenger" && ch.field === "feed" && v.item === "comment" && v.verb === "add" && v.comment_id) {
        out.push({ type: "comment", platform: "facebook", channelExternalId: own, commentId: v.comment_id, postId: v.post_id ?? null,
          parentId: v.parent_id && v.parent_id !== v.post_id ? v.parent_id : null, authorId: v.from?.id ?? null, authorName: v.from?.name ?? null,
          text: v.message ?? "", at: secs(v.created_time) });
      }
      if (kind === "instagram" && ch.field === "comments" && v.id) {
        out.push({ type: "comment", platform: "instagram", channelExternalId: own, commentId: v.id, postId: v.media?.id ?? null,
          parentId: v.parent_id ?? null, authorId: v.from?.id ?? null, authorName: v.from?.username ?? null, text: v.text ?? "", at: null });
      }
    }
  }
  return out;
}
