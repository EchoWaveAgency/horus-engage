// The conversation engine: one customer message in → what to say, the next state, and any handoff / booking.
// Pure and deterministic (no I/O, no clock unless passed in). Every answer comes from the client's approved
// services / FAQs; the bot never invents prices or gives medical advice. A language-model hint can only choose
// among the same intents and services the rules use.
import { campaignCode, intents, isArabic, norm, normalizePhone, type Intent } from "./text";

export type Lang = "ar" | "en";
export type Channel = "whatsapp" | "messenger" | "instagram";
export type Service = {
  code: string; name_ar: string; name_en: string; summary_ar: string; summary_en: string;
  offer_ar?: string | null; offer_en?: string | null; price_ar?: string | null; price_en?: string | null;
  duration_ar?: string | null; duration_en?: string | null; booking_mode: "request" | "human_only";
  keywords: string[]; campaign_codes: string[];
};
export type Faq = { service_code?: string | null; question_ar: string; question_en: string; answer_ar: string; answer_en: string; keywords: string[] };
export type Settings = {
  greeting_ar: string; greeting_en: string; handoff_ar: string; handoff_en: string;
  after_hours_ar?: string | null; after_hours_en?: string | null; max_unknown: number; ask_phone: boolean;
};
export type Step = "start" | "menu" | "service" | "book_day" | "book_period" | "ask_phone" | "done";
export type State = { step?: Step; service?: string; unknown?: number; lang?: Lang; day?: string; period?: string; cc?: string };
export type Event = { type: "text"; text: string } | { type: "button"; id: string; title?: string };
export type Hint = { intent?: Intent | "other"; service?: string | null; faq?: number | null };
export type Ctx = {
  channel: Channel; contact: { name?: string | null; phone?: string | null; lang?: Lang | null };
  services: Service[]; faqs: Faq[]; settings: Settings; today: string; inHours: boolean;
  referralText?: string | null;   // ad headline / body (Click-to-WhatsApp)
  hint?: Hint | null;
};
export type Button = { id: string; title: string };
export type Out =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: Button[] }
  | { kind: "list"; body: string; button: string; rows: (Button & { description?: string })[] };
export type Result = {
  say: Out[]; state: State; status: "bot" | "human";
  handoffReason?: "asked_human" | "medical_question" | "complaint" | "not_understood" | "price_unknown" | "booking_human" | "media";
  serviceCode?: string; campaignCode?: string;
  booking?: { day: string; period: string; note: string };
  contact?: { phone?: string; lang?: Lang };
  usedAi?: boolean;
  understood?: false;   // the rules could not place the message (the runner may ask the language model, then retry once)
};

const T = {
  menu: { ar: "اختار الخدمة اللي تهمك 👇", en: "Choose the service you are interested in 👇" },
  menuButton: { ar: "الخدمات", en: "Services" },
  book: { ar: "احجز الآن", en: "Book now" },
  ask: { ar: "عندي سؤال", en: "I have a question" },
  human: { ar: "كلّمني موظف", en: "Talk to a person" },
  services: { ar: "خدمات تانية", en: "Other services" },
  askQuestion: { ar: "اكتب سؤالك عن {s} وأنا أرد عليك ✍️", en: "Type your question about {s} ✍️" },
  offer: { ar: "🎁 العرض", en: "🎁 Offer" },
  price: { ar: "💰 السعر", en: "💰 Price" },
  duration: { ar: "⏱ المدة", en: "⏱ Duration" },
  pickDay: { ar: "تمام 👌 تحب الحجز يوم إيه؟", en: "Great 👌 Which day suits you?" },
  pickDayButton: { ar: "اختار اليوم", en: "Choose a day" },
  pickPeriod: { ar: "وأنهي وقت يناسبك؟", en: "Which time of day?" },
  periods: { morning: { ar: "الصبح", en: "Morning" }, afternoon: { ar: "الضهر", en: "Afternoon" }, evening: { ar: "بالليل", en: "Evening" } } as Record<string, { ar: string; en: string }>,
  askPhone: { ar: "ابعتلي رقم موبايلك علشان فريقنا يأكد معاك الميعاد 📱", en: "Please send your mobile number so our team can confirm the time 📱" },
  badPhone: { ar: "الرقم مش واضح 🙏 ابعته كده: 01xxxxxxxxx", en: "That number doesn't look right 🙏 Please send it like 01xxxxxxxxx" },
  booked: { ar: "✅ تم تسجيل طلب الحجز: {s} — {d} ({p}).\nفريقنا هيتواصل معاك قريب جدًا لتأكيد الميعاد بالظبط.", en: "✅ Booking request received: {s} — {d} ({p}).\nOur team will contact you shortly to confirm the exact time." },
  noPrice: { ar: "السعر بيتحدد حسب الحالة، هحوّلك لحد من الفريق يوضحلك بالتفصيل 🙏", en: "The price depends on your case; a team member will explain it in detail 🙏" },
  medical: { ar: "سؤالك محتاج رد من فريقنا المتخصص، هحوّلك لهم حالًا 🙏", en: "Your question needs our specialist team; I'm passing you to them now 🙏" },
  complaint: { ar: "نأسف جدًا لده 🙏 هحوّلك فورًا لمسؤول يتابع معاك بنفسه.", en: "We're very sorry 🙏 A manager will follow up with you personally right away." },
  notUnderstood: { ar: "معلش مش فاهم قصدك كويس 🙏", en: "Sorry, I didn't quite get that 🙏" },
  thanks: { ar: "العفو 🤍 لو محتاج أي حاجة أنا هنا.", en: "You're welcome 🤍 I'm here if you need anything." },
  done: { ar: "أي خدمة تانية أقدر أساعدك فيها؟", en: "Can I help you with anything else?" },
  humanOnly: { ar: "حجز {s} بيتم مع فريقنا مباشرة، هحوّلك لهم حالًا 🙏", en: "{s} is booked directly with our team; passing you to them now 🙏" },
};

const L = (o: { ar: string; en: string }, lang: Lang) => o[lang];
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const svcName = (s: Service, lang: Lang) => (lang === "ar" ? s.name_ar : s.name_en);

function langOf(ctx: Ctx, st: State, ev: Event): Lang {
  if (ev.type === "text" && ev.text.trim()) {
    if (isArabic(ev.text)) return "ar";
    if (/[a-z]{3,}/i.test(ev.text)) return "en";
  }
  return st.lang ?? ctx.contact.lang ?? "ar";
}

export function findService(text: string, services: Service[]): Service | null {
  const t = norm(text);
  if (!t) return null;
  let best: { s: Service; score: number } | null = null;
  for (const s of services) {
    let score = 0;
    if (norm(s.name_ar) === t || norm(s.name_en) === t || s.code.toLowerCase() === t) score = 100;
    for (const k of s.keywords) if (k && t.includes(norm(k))) score = Math.max(score, 10 + norm(k).length);
    if (t.includes(norm(s.name_ar)) || t.includes(norm(s.name_en))) score = Math.max(score, 20);
    if (score > 0 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}

export function findFaq(text: string, faqs: Faq[], service?: string): Faq | null {
  const t = norm(text);
  let best: { f: Faq; score: number } | null = null;
  for (const f of faqs) {
    if (f.service_code && service && f.service_code !== service) continue;
    const hits = f.keywords.filter((k) => k && t.includes(norm(k))).length;
    if (!hits) continue;
    const score = hits * 10 + (f.service_code && f.service_code === service ? 5 : 0);
    if (!best || score > best.score) best = { f, score };
  }
  return best?.f ?? null;
}

export function menu(ctx: Ctx, lang: Lang, intro?: string): Out {
  const rows = ctx.services.slice(0, 10).map((s) => ({ id: `svc:${s.code}`, title: svcName(s, lang) }));
  const body = [intro, L(T.menu, lang)].filter(Boolean).join("\n\n");
  if (rows.length <= 3) return { kind: "buttons", body, buttons: rows };
  return { kind: "list", body, button: L(T.menuButton, lang), rows };
}

export function serviceCard(s: Service, lang: Lang): Out {
  const ar = lang === "ar";
  const lines = [`*${svcName(s, lang)}*`, ar ? s.summary_ar : s.summary_en];
  const offer = ar ? s.offer_ar : s.offer_en;
  const price = ar ? s.price_ar : s.price_en;
  const duration = ar ? s.duration_ar : s.duration_en;
  if (offer) lines.push(`${L(T.offer, lang)}: ${offer}`);
  if (price) lines.push(`${L(T.price, lang)}: ${price}`);
  if (duration) lines.push(`${L(T.duration, lang)}: ${duration}`);
  return { kind: "buttons", body: lines.join("\n"), buttons: [
    { id: "book", title: L(T.book, lang) }, { id: "question", title: L(T.ask, lang) }, { id: "human", title: L(T.human, lang) },
  ] };
}

function afterService(lang: Lang): Out {
  return { kind: "buttons", body: L(T.done, lang), buttons: [
    { id: "book", title: L(T.book, lang) }, { id: "menu", title: L(T.services, lang) }, { id: "human", title: L(T.human, lang) },
  ] };
}

const ARABIC_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function nextDays(today: string, n = 7): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); out.push(d.toISOString().slice(0, 10)); }
  return out;
}
export function dayLabel(day: string, today: string, lang: Lang): string {
  const d = new Date(`${day}T12:00:00Z`);
  const diff = Math.round((d.getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86400_000);
  const name = (lang === "ar" ? ARABIC_DAYS : EN_DAYS)[d.getUTCDay()];
  const dm = `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  if (diff === 0) return lang === "ar" ? `النهارده ${dm}` : `Today ${dm}`;
  if (diff === 1) return lang === "ar" ? `بكرة ${dm}` : `Tomorrow ${dm}`;
  return `${name} ${dm}`;
}
function dayPicker(ctx: Ctx, lang: Lang): Out {
  return { kind: "list", body: L(T.pickDay, lang), button: L(T.pickDayButton, lang),
    rows: nextDays(ctx.today, 7).map((d) => ({ id: `day:${d}`, title: dayLabel(d, ctx.today, lang) })) };
}
function periodPicker(lang: Lang): Out {
  return { kind: "buttons", body: L(T.pickPeriod, lang),
    buttons: (["morning", "afternoon", "evening"] as const).map((p) => ({ id: `period:${p}`, title: L(T.periods[p], lang) })) };
}

function handoff(ctx: Ctx, st: State, lang: Lang, reason: NonNullable<Result["handoffReason"]>, lead?: string): Result {
  const say: Out[] = [{ kind: "text", body: [lead, L({ ar: ctx.settings.handoff_ar, en: ctx.settings.handoff_en }, lang)].filter(Boolean).join("\n") }];
  const after = lang === "ar" ? ctx.settings.after_hours_ar : ctx.settings.after_hours_en;
  if (!ctx.inHours && after) say.push({ kind: "text", body: after });
  return { say, state: { ...st, lang, step: st.step }, status: "human", handoffReason: reason, serviceCode: st.service };
}

function confirmBooking(ctx: Ctx, st: State, lang: Lang, phone?: string): Result {
  const s = ctx.services.find((x) => x.code === st.service);
  const period = L(T.periods[st.period ?? "morning"], lang);
  const day = dayLabel(st.day!, ctx.today, lang);
  return {
    say: [{ kind: "text", body: fill(L(T.booked, lang), { s: s ? svcName(s, lang) : "", d: day, p: period }) }],
    state: { ...st, lang, step: "done", unknown: 0 }, status: "bot", serviceCode: st.service,
    booking: { day: st.day!, period: st.period!, note: [s?.code, st.cc].filter(Boolean).join(" · ") },
    contact: phone ? { phone, lang } : { lang },
  };
}

function startBooking(ctx: Ctx, st: State, lang: Lang): Result {
  const s = ctx.services.find((x) => x.code === st.service);
  if (!s) return { say: [menu(ctx, lang)], state: { ...st, lang, step: "menu" }, status: "bot" };
  if (s.booking_mode === "human_only") return handoff(ctx, st, lang, "booking_human", fill(L(T.humanOnly, lang), { s: svcName(s, lang) }));
  return { say: [dayPicker(ctx, lang)], state: { ...st, lang, step: "book_day", unknown: 0 }, status: "bot", serviceCode: s.code };
}

function unknown(ctx: Ctx, st: State, lang: Lang): Result {
  const n = (st.unknown ?? 0) + 1;
  if (n >= ctx.settings.max_unknown) return { ...handoff(ctx, { ...st, unknown: n }, lang, "not_understood", L(T.notUnderstood, lang)), understood: false };
  const s = ctx.services.find((x) => x.code === st.service);
  const again: Out = s && st.step === "service" ? serviceCard(s, lang) : menu(ctx, lang);
  return { say: [{ kind: "text", body: L(T.notUnderstood, lang) }, again], state: { ...st, lang, unknown: n }, status: "bot", understood: false };
}

/** One step of the conversation. */
export function step(ctx: Ctx, prev: State, ev: Event): Result {
  const st: State = { step: "start", unknown: 0, ...prev };
  const lang = langOf(ctx, st, ev);
  const text = ev.type === "text" ? ev.text : "";
  const id = ev.type === "button" ? ev.id : null;
  let found = ev.type === "text" ? intents(text) : [];
  // The model's opinion is used only when the rules found nothing — and it can only pick from the same intents.
  let usedAi = false;
  if (!found.length && ctx.hint?.intent && ctx.hint.intent !== "other") { found = [ctx.hint.intent]; usedAi = true; }
  const has = (i: Intent) => found.includes(i);
  const withAi = (r: Result): Result => (usedAi ? { ...r, usedAi } : r);

  // 1. People and safety first.
  if (id === "human" || has("human")) return withAi(handoff(ctx, st, lang, "asked_human"));
  if (has("complaint")) return withAi(handoff(ctx, st, lang, "complaint", L(T.complaint, lang)));
  if (has("medical")) return withAi(handoff(ctx, st, lang, "medical_question", L(T.medical, lang)));

  // 2. Steps that expect a specific answer.
  if (st.step === "book_day") {
    const day = id?.startsWith("day:") ? id.slice(4) : null;
    if (day && nextDays(ctx.today, 7).includes(day)) return { say: [periodPicker(lang)], state: { ...st, lang, day, step: "book_period", unknown: 0 }, status: "bot" };
    if (has("menu")) return { say: [menu(ctx, lang)], state: { ...st, lang, step: "menu", unknown: 0 }, status: "bot" };
    return unknown(ctx, st, lang);
  }
  if (st.step === "book_period") {
    const period = id?.startsWith("period:") ? id.slice(7) : (["morning", "afternoon", "evening"] as const).find((p) => norm(text).includes(norm(T.periods[p].ar)) || norm(text).includes(p));
    if (period && T.periods[period]) {
      const next = { ...st, period };
      if (ctx.channel !== "whatsapp" && !ctx.contact.phone && ctx.settings.ask_phone) {
        return { say: [{ kind: "text", body: L(T.askPhone, lang) }], state: { ...next, lang, step: "ask_phone", unknown: 0 }, status: "bot" };
      }
      return confirmBooking(ctx, next, lang);
    }
    return unknown(ctx, st, lang);
  }
  if (st.step === "ask_phone") {
    const phone = normalizePhone(text);
    if (phone) return confirmBooking(ctx, st, lang, phone);
    const n = (st.unknown ?? 0) + 1;
    if (n >= ctx.settings.max_unknown + 1) return handoff(ctx, { ...st, unknown: n }, lang, "not_understood");
    return { say: [{ kind: "text", body: L(T.badPhone, lang) }], state: { ...st, lang, unknown: n }, status: "bot" };
  }

  // 3. Buttons.
  if (id === "menu") return { say: [menu(ctx, lang)], state: { ...st, lang, step: "menu", unknown: 0 }, status: "bot" };
  if (id?.startsWith("svc:")) {
    const s = ctx.services.find((x) => x.code === id.slice(4));
    if (s) return { say: [serviceCard(s, lang)], state: { ...st, lang, step: "service", service: s.code, unknown: 0 }, status: "bot", serviceCode: s.code };
  }
  if (id === "book") return startBooking(ctx, st, lang);
  if (id === "question") {
    const s = ctx.services.find((x) => x.code === st.service);
    return { say: [{ kind: "text", body: fill(L(T.askQuestion, lang), { s: s ? svcName(s, lang) : "" }) }], state: { ...st, lang, step: "service", unknown: 0 }, status: "bot" };
  }

  // 4. Free text.
  const codes = ctx.services.flatMap((s) => s.campaign_codes);
  const cc = st.step === "start" ? campaignCode(`${text} ${ctx.referralText ?? ""}`, codes) : null;
  const byCode = cc ? ctx.services.find((s) => s.campaign_codes.includes(cc)) : null;
  const numbered = /^\d{1,2}$/.test(norm(text)) && (st.step === "menu" || st.step === "start" || st.step === "done") ? ctx.services[Number(norm(text)) - 1] : undefined;
  const byText = byCode ?? numbered ?? findService(text, ctx.services) ?? (ctx.hint?.service ? ctx.services.find((s) => s.code === ctx.hint!.service) : undefined) ?? null;
  if (byText && !byCode && !numbered && !findService(text, ctx.services)) usedAi = true;
  const current = byText ?? ctx.services.find((s) => s.code === st.service) ?? null;

  if (has("book") && current) return withAi(startBooking(ctx, { ...st, service: current.code, cc: cc ?? st.cc }, lang));
  if ((has("price") || has("duration")) && current) {
    const v = has("price") ? (lang === "ar" ? current.price_ar : current.price_en) : (lang === "ar" ? current.duration_ar : current.duration_en);
    if (!v) return withAi(handoff(ctx, { ...st, service: current.code }, lang, "price_unknown", L(T.noPrice, lang)));
    return withAi({ say: [{ kind: "text", body: `${L(has("price") ? T.price : T.duration, lang)} — ${svcName(current, lang)}: ${v}` }, afterService(lang)],
      state: { ...st, lang, step: "service", service: current.code, unknown: 0 }, status: "bot", serviceCode: current.code });
  }
  const faq = findFaq(text, ctx.faqs, current?.code) ?? (ctx.hint?.faq != null ? ctx.faqs[ctx.hint.faq] ?? null : null);
  if (faq && !(byText && st.step !== "service")) {
    return withAi({ say: [{ kind: "text", body: lang === "ar" ? faq.answer_ar : faq.answer_en }, afterService(lang)],
      state: { ...st, lang, step: current ? "service" : "menu", unknown: 0 }, status: "bot" });
  }
  if (byText) {
    const intro = st.step === "start" ? greeting(ctx, lang) : null;
    return withAi({ say: [...(intro ? [{ kind: "text", body: intro } as Out] : []), serviceCard(byText, lang)],
      state: { ...st, lang, step: "service", service: byText.code, unknown: 0, cc: cc ?? st.cc }, status: "bot", serviceCode: byText.code,
      ...(cc ? { campaignCode: cc } : {}) });
  }
  if (has("price") || has("book") || has("duration")) {
    return { say: [menu(ctx, lang)], state: { ...st, lang, step: "menu", unknown: 0 }, status: "bot" };
  }
  if (has("thanks")) return { say: [{ kind: "text", body: L(T.thanks, lang) }], state: { ...st, lang }, status: "bot" };
  if (st.step === "start" || has("greeting") || has("menu") || st.step === "done") {
    return { say: [menu(ctx, lang, st.step === "start" || has("greeting") ? greeting(ctx, lang) : undefined)], state: { ...st, lang, step: "menu", unknown: 0 }, status: "bot" };
  }
  return unknown(ctx, st, lang);
}

function greeting(ctx: Ctx, lang: Lang): string {
  const g = lang === "ar" ? ctx.settings.greeting_ar : ctx.settings.greeting_en;
  const name = ctx.contact.name?.split(" ")[0];
  if (g.includes("{name}")) return g.replace("{name}", name ?? "").replace(/\s+([👋!،,])/u, " $1");
  return name ? g.replace(/^(أهلاً بيك|أهلاً|اهلا|Hello|Hi)/, (m) => (lang === "ar" ? `${m} يا ${name}` : `${m} ${name}`)) : g;
}

/** Voice notes / images: a person looks at them. */
export function mediaStep(ctx: Ctx, prev: State): Result {
  const lang = prev.lang ?? ctx.contact.lang ?? "ar";
  return handoff(ctx, { step: "start", ...prev }, lang, "media");
}
