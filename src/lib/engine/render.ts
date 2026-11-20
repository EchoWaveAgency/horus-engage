// Turns engine output into the exact payload each Meta channel accepts, within Meta's size limits. Pure.
import type { Channel, Out } from "./bot";

const cut = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

/** WhatsApp Cloud API message body (without messaging_product / to). */
export function whatsapp(o: Out): Record<string, unknown> {
  if (o.kind === "text") return { type: "text", text: { preview_url: false, body: cut(o.body, 4096) } };
  if (o.kind === "buttons" && o.buttons.length <= 3) {
    return { type: "interactive", interactive: { type: "button", body: { text: cut(o.body, 1024) },
      action: { buttons: o.buttons.map((b) => ({ type: "reply", reply: { id: cut(b.id, 256), title: cut(b.title, 20) } })) } } };
  }
  const rows = o.kind === "list" ? o.rows : o.buttons;
  return { type: "interactive", interactive: { type: "list", body: { text: cut(o.body, 1024) },
    action: { button: cut(o.kind === "list" ? o.button : "اختار", 20), sections: [{ title: cut(o.kind === "list" ? o.button : "Options", 24),
      rows: rows.slice(0, 10).map((r) => {
        const d = (r as { description?: string }).description;
        return { id: cut(r.id, 200), title: cut(r.title, 24), ...(d ? { description: cut(d, 72) } : {}) };
      }) }] } } };
}

/** WhatsApp *bold* is not supported on Messenger / Instagram: drop the markers there. */
const unbold = (s: string) => s.replace(/\*([^*\n]+)\*/g, "$1");

/** Messenger / Instagram Send API `message` object (quick replies, max 13, titles 20). */
export function messenger(o: Out): Record<string, unknown> {
  if (o.kind === "text") return { text: cut(unbold(o.body), 2000) };
  const opts = o.kind === "list" ? o.rows : o.buttons;
  return { text: cut(unbold(o.body), 2000), quick_replies: opts.slice(0, 13).map((b) => ({ content_type: "text", title: cut(b.title, 20), payload: cut(b.id, 1000) })) };
}

/** Plain text with numbered options — for comment private replies and any channel without buttons. */
export function plain(o: Out): string {
  if (o.kind === "text") return unbold(o.body);
  const opts = o.kind === "list" ? o.rows : o.buttons;
  return `${unbold(o.body)}\n\n${opts.map((b, i) => `${i + 1}. ${b.title}`).join("\n")}`;
}

export function render(channel: Channel, o: Out): Record<string, unknown> {
  return channel === "whatsapp" ? whatsapp(o) : messenger(o);
}

/** Text kept in the conversation history for an outgoing message. */
export function historyBody(o: Out): string {
  return o.kind === "text" ? o.body : `${o.body}\n\n${(o.kind === "list" ? o.rows : o.buttons).map((b, i) => `${i + 1}. ${b.title}`).join("\n")}`;
}
