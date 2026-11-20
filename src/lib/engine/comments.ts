// What to do with a comment. Pure: the runner performs the actions on Meta and records them.
import { classifyComment, type CommentClass } from "./text";

export type CommentSettings = {
  comment_public_reply: boolean; comment_private_reply: boolean; comment_hide_spam: boolean; comment_escalate: boolean;
  comment_thank_positive: boolean; comment_replies_ar: string[]; comment_replies_en: string[]; comment_thanks_ar: string[];
  comment_thanks_en: string[]; comment_complaint_ar: string; comment_complaint_en: string;
};
export type CommentPlan = {
  classification: CommentClass;
  hide: boolean;
  publicReply: string | null;
  privateReply: boolean;          // one private reply per comment, within 7 days
  privateMode: "menu" | "complaint" | null;   // menu → service menu DM; complaint → apology DM, conversation goes to a person
  status: "auto_handled" | "needs_human" | "ignored";
};

/** Stable pick so replies vary across comments (Meta flags identical repeated replies) but a retry gives the same one. */
export function pick(list: string[], seed: string): string | null {
  if (!list.length) return null;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

export function planComment(text: string, commentId: string, s: CommentSettings, opts: { isReply?: boolean; ageDays?: number; hint?: CommentClass | null } = {}): CommentPlan {
  let cls = classifyComment(text);
  if (cls === "other" && opts.hint) cls = opts.hint;   // the model may refine only what the rules could not place
  const en = /[a-z]{3,}/i.test(text) && !/[؀-ۿ]/.test(text);
  const canDm = (opts.ageDays ?? 0) < 7;
  switch (cls) {
    case "spam":
    case "abuse":
      return { classification: cls, hide: s.comment_hide_spam, publicReply: null, privateReply: false, privateMode: null, status: s.comment_hide_spam ? "auto_handled" : "needs_human" };
    case "complaint":
      return { classification: cls, hide: false, publicReply: s.comment_escalate && canDm ? (en ? s.comment_complaint_en : s.comment_complaint_ar) : null,
        privateReply: s.comment_escalate && canDm, privateMode: s.comment_escalate && canDm ? "complaint" : null, status: "needs_human" };
    case "inquiry":
    case "price": {
      const reply = s.comment_public_reply && s.comment_private_reply && canDm ? pick(en ? s.comment_replies_en : s.comment_replies_ar, commentId) : null;
      const dm = s.comment_private_reply && canDm;
      return { classification: cls, hide: false, publicReply: reply, privateReply: dm, privateMode: dm ? "menu" : null, status: dm ? "auto_handled" : "needs_human" };
    }
    case "positive":
      return { classification: cls, hide: false, publicReply: s.comment_thank_positive && !opts.isReply ? pick(en ? s.comment_thanks_en : s.comment_thanks_ar, commentId) : null,
        privateReply: false, privateMode: null, status: "auto_handled" };
    default:
      return { classification: "other", hide: false, publicReply: null, privateReply: false, privateMode: null, status: "ignored" };
  }
}
