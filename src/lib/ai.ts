import "server-only";
import type { Hint, Service, Faq } from "@/lib/engine/bot";
import type { CommentClass } from "@/lib/engine/text";

// Optional language-model understanding (Claude). Used only when the client switched it on (bot_settings.ai_enabled)
// and ANTHROPIC_API_KEY is set, and only for messages the rules could not place. It never writes the answer: it may
// only choose one of the client's own services / FAQs or an intent; the engine then answers from approved text.
const MODEL = process.env.ENGAGE_AI_MODEL ?? "claude-haiku-5-5";
const INTENTS = ["human", "book", "price", "duration", "location", "hours", "medical", "complaint", "thanks", "greeting", "menu", "other"] as const;

async function ask(system: string, user: string): Promise<Record<string, unknown> | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 120, temperature: 0, system, messages: [{ role: "user", content: user.slice(0, 1500) }] }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = j.content?.find((c) => c.type === "text")?.text ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function messageHint(text: string, services: Service[], faqs: Faq[]): Promise<Hint | null> {
  const system = `You route customer messages for a clinic's WhatsApp/Messenger booking assistant. Reply with JSON only:
{"intent": one of ${JSON.stringify(INTENTS)}, "service": one of ${JSON.stringify(services.map((s) => s.code))} or null, "faq": index or null}
Services: ${services.map((s) => `${s.code}=${s.name_ar}/${s.name_en}`).join("; ")}
FAQs: ${faqs.map((f, i) => `${i}=${f.question_ar}`).join("; ")}
"medical" = the person describes symptoms, a condition, pregnancy, medicines or asks for medical advice. "human" = wants a person. Never answer the customer.`;
  const r = await ask(system, text);
  if (!r) return null;
  const intent = INTENTS.includes(r.intent as (typeof INTENTS)[number]) ? (r.intent as Hint["intent"]) : undefined;
  const service = services.some((s) => s.code === r.service) ? (r.service as string) : null;
  const faq = typeof r.faq === "number" && faqs[r.faq] ? r.faq : null;
  return { intent, service, faq };
}

export async function commentHint(text: string): Promise<CommentClass | null> {
  const r = await ask(`Classify a comment on a clinic's Facebook/Instagram post. JSON only: {"class": "inquiry"|"price"|"positive"|"complaint"|"spam"|"abuse"|"other"}.
"inquiry" = interested / wants details or booking. Do not reply to the customer.`, text);
  const c = r?.class;
  return ["inquiry", "price", "positive", "complaint", "spam", "abuse", "other"].includes(c as string) ? (c as CommentClass) : null;
}
