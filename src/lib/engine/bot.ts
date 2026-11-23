// The conversation engine: one customer message in → what to say, the next state, and any handoff / booking.
// Pure and deterministic (no I/O, no clock unless passed in). Every answer comes from the client's approved
// services / FAQs; the bot never invents prices or gives medical advice. A language-model hint can only choose
// among the same intents and services the rules use.
//
// Two booking flows (bot_settings.booking_flow):
//   slots   service → day → time → booking request (the bot keeps the conversation)
//   intake  service → the service's filter question → first visit or follow-up → time → name → a person takes over
import { campaignCode, intents, isArabic, norm, normalizePhone, type Intent } from "./text";

export type Lang = "ar" | "en";
export type Channel = "whatsapp" | "messenger" | "instagram";
export type Service = {
  code: string; name_ar: string; name_en: string; summary_ar: string; summary_en: string;
  offer_ar?: string | null; offer_en?: string | null; price_ar?: string | null; price_en?: string | null;
  duration_ar?: string | null; duration_en?: string | null; booking_mode: "request" | "human_only";
  keywords: string[]; campaign_codes: string[];
  filter_question_ar?: string | null; filter_question_en?: string | null; filter_options?: Option[] | null;
};
export type Option = { ar: string; en: string };
/** What happens after an approved answer: stay, continue to the intake, hand to a person, or emergency. */
export type FaqHandoff = "no" | "after_filter" | "yes" | "urgent";
export type Faq = { service_code?: string | null; question_ar: string; question_en: string; answer_ar: string; answer_en: string; keywords: string[]; handoff?: FaqHandoff | null };
export type Settings = {
  greeting_ar: string; greeting_en: string; handoff_ar: string; handoff_en: string;
  after_hours_ar?: string | null; after_hours_en?: string | null; max_unknown: number; ask_phone: boolean;
  booking_flow?: "slots" | "intake" | null;
  intake_visit_ar?: string | null; intake_visit_en?: string | null;   // empty = the visit question is not asked
  intake_done_ar?: string | null; intake_done_en?: string | null;
  emergency_ar?: string | null; emergency_en?: string | null;
  medical_ar?: string | null; medical_en?: string | null;
};
export type Step = "start" | "menu" | "service" | "book_day" | "book_period" | "ask_phone" | "done"
  | "filter" | "visit" | "period" | "name";   // intake
export type State = { step?: Step; service?: string; unknown?: number; lang?: Lang; day?: string; period?: string; cc?: string;
  filter?: string; visit?: "first" | "follow_up"; name?: string };
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
  handoffReason?: "asked_human" | "medical_question" | "complaint" | "not_understood" | "price_unknown" | "booking_human" | "media"
    | "emergency" | "faq" | "intake_done";
  serviceCode?: string; campaignCode?: string;
  booking?: { day: string | null; period: string; note: string };
  contact?: { phone?: string; lang?: Lang; name?: string };
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
  periods: { morning: { ar: "الصبح", en: "Morning" }, afternoon: { ar: "بعد الضهر", en: "Afternoon" }, evening: { ar: "بالليل", en: "Evening" } } as Record<string, { ar: string; en: string }>,
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
  // intake
  options: { ar: "اختار", en: "Choose" },
  visitFirst: { ar: "أول مرة", en: "First visit" },
  visitFollow: { ar: "متابعة", en: "Follow-up" },
  intakePeriod: { ar: "الوقت الأنسب ليك؟", en: "Which time suits you best?" },
  intakeName: { ar: "آخر سؤال: اسمك الكريم؟", en: "Last question: may I have your name?" },
  intakeDone: { ar: "شكراً يا {name}. زميلتنا في خدمة العملاء هتكمّل معاك هنا في أقرب وقت، وهتأكد معاك الميعاد والدكتور المناسب.",
                en: "Thank you, {name}. Our customer-service colleague will continue with you here shortly to confirm the time and the right doctor." },
  emergency: { ar: "لو حالتك طارئة، من فضلك اتوجّه لأقرب طوارئ فوراً. زميلتنا هتتواصل معاك كمان في أسرع وقت.",
               en: "If this is an emergency, please go to the nearest emergency room right away. Our colleague will also contact you as soon as possible." },
  thisService: { ar: "التخصص ده", en: "this specialty" },
};
const PERIOD_WORDS: Record<string, string[]> = {
  morning: ["الصبح", "صباحا", "بدري", "morning"], afternoon: ["بعد الضهر", "الضهر", "العصر", "afternoon", "noon"],
  evening: ["بالليل", "الليل", "المسا", "مساء", "evening", "night"],
};

const L = (o: { ar: string; en: string }, lang: Lang) => o[lang];
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const svcName = (s: Service, lang: Lang) => (lang === "ar" ? s.name_ar : s.name_en);
const pick = (lang: Lang, ar?: string | null, en?: string | null) => (lang === "ar" ? ar || null : en || ar || null);
const isIntakeFlow = (ctx: Ctx) => ctx.settings.booking_flow === "intake";
const INTAKE_STEPS: Step[] = ["filter", "visit", "period", "name"];
const inIntake = (st: State) => INTAKE_STEPS.includes(st.step as Step) || (st.step === "ask_phone" && Boolean(st.name));
function faqAnswer(f: Faq, lang: Lang, s: Service | null): string {
  return (lang === "ar" ? f.answer_ar : f.answer_en || f.answer_ar).replace(/\{service\}/g, s ? svcName(s, lang) : L(T.thisService, lang));
}

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

export function findFaq(text: string, faqs: Faq[], service?: string | null): Faq | null {
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
  const again: Out = (inIntake(st) ? intakeQuestion(ctx, st, lang) : null) ?? (s && st.step === "service" ? serviceCard(s, lang) : menu(ctx, lang));
  return { say: [{ kind: "text", body: L(T.notUnderstood, lang) }, again], state: { ...st, lang, unknown: n }, status: "bot", understood: false };
}

// ---------------------------------------------------------------- Intake
function choices(body: string, lang: Lang, opts: Button[]): Out {
  return opts.length <= 3 ? { kind: "buttons", body, buttons: opts } : { kind: "list", body, button: L(T.options, lang), rows: opts };
}
const filterOptions = (s: Service): Option[] => (s.filter_options ?? []).filter((o) => o && o.ar);
const hasFilter = (s: Service) => Boolean(s.filter_question_ar) && filterOptions(s).length > 0;
const visitQuestion = (ctx: Ctx, lang: Lang) => pick(lang, ctx.settings.intake_visit_ar, ctx.settings.intake_visit_en);

/** The question the customer is being asked now (asked again after an answer to something else). */
function intakeQuestion(ctx: Ctx, st: State, lang: Lang): Out | null {
  const s = ctx.services.find((x) => x.code === st.service);
  switch (st.step) {
    case "filter":
      if (!s || !hasFilter(s)) return null;
      return choices(pick(lang, s.filter_question_ar, s.filter_question_en)!, lang,
        filterOptions(s).map((o, i) => ({ id: `opt:${i}`, title: lang === "ar" ? o.ar : o.en || o.ar })));
    case "visit": {
      const q = visitQuestion(ctx, lang);
      return q ? { kind: "buttons", body: q, buttons: [{ id: "visit:first", title: L(T.visitFirst, lang) }, { id: "visit:follow_up", title: L(T.visitFollow, lang) }] } : null;
    }
    case "period":
      return { kind: "buttons", body: L(T.intakePeriod, lang),
        buttons: (["morning", "afternoon", "evening"] as const).map((p) => ({ id: `period:${p}`, title: L(T.periods[p], lang) })) };
    case "name": return { kind: "text", body: L(T.intakeName, lang) };
    case "ask_phone": return { kind: "text", body: L(T.askPhone, lang) };
    default: return null;
  }
}

/** Asks the next unanswered intake question, or hands the finished intake to a person. */
function nextIntake(ctx: Ctx, st: State, lang: Lang, lead: Out[] = []): Result {
  const s = ctx.services.find((x) => x.code === st.service);
  let next: Step | null = null;
  if (st.filter === undefined && s && hasFilter(s)) next = "filter";
  else if (!st.visit && visitQuestion(ctx, lang)) next = "visit";
  else if (!st.period) next = "period";
  else if (!st.name) next = "name";
  else if (ctx.channel !== "whatsapp" && !ctx.contact.phone && ctx.settings.ask_phone) next = "ask_phone";
  if (!next) return finishIntake(ctx, st, lang, undefined, lead);
  const ns: State = { ...st, lang, step: next, unknown: 0 };
  return { say: [...lead, intakeQuestion(ctx, ns, lang)!], state: ns, status: "bot", serviceCode: st.service };
}

function startIntake(ctx: Ctx, st: State, lang: Lang, s: Service, lead: Out[] = [], cc?: string | null): Result {
  const base: State = { ...st, service: s.code, cc: cc ?? st.cc, filter: undefined, visit: undefined, period: undefined, name: undefined };
  if (s.booking_mode === "human_only") {
    const h = handoff(ctx, base, lang, "booking_human", fill(L(T.humanOnly, lang), { s: svcName(s, lang) }));
    return { ...h, say: [...lead, ...h.say], ...(cc ? { campaignCode: cc } : {}) };
  }
  const offer = lang === "ar" ? s.offer_ar : s.offer_en;
  const intro = offer ? [...lead, { kind: "text", body: `*${svcName(s, lang)}*\n${L(T.offer, lang)}: ${offer}` } as Out] : lead;
  const r = nextIntake(ctx, base, lang, intro);
  return { ...r, serviceCode: s.code, ...(cc ? { campaignCode: cc } : {}) };
}

function finishIntake(ctx: Ctx, st: State, lang: Lang, phone?: string, lead: Out[] = []): Result {
  const s = ctx.services.find((x) => x.code === st.service);
  const name = st.name ?? "";
  const done = (pick(lang, ctx.settings.intake_done_ar, ctx.settings.intake_done_en) ?? L(T.intakeDone, lang)).replace(/\{name\}/g, name).replace(/\s+([.،,])/u, "$1");
  const say: Out[] = [...lead, { kind: "text", body: done }];
  const after = lang === "ar" ? ctx.settings.after_hours_ar : ctx.settings.after_hours_en;
  if (!ctx.inHours && after) say.push({ kind: "text", body: after });
  const visit = st.visit ? T[st.visit === "first" ? "visitFirst" : "visitFollow"].ar : null;
  const note = [s?.code, st.filter, visit, st.period ? T.periods[st.period]?.ar : null, name, st.cc].filter(Boolean).join(" · ");
  return {
    say, state: { ...st, lang, step: "done", unknown: 0 }, status: "human", handoffReason: "intake_done", serviceCode: st.service,
    booking: { day: null, period: st.period ?? "", note }, contact: { lang, ...(name ? { name } : {}), ...(phone ? { phone } : {}) },
  };
}

function matchOption(t: string, opts: Option[]): number {
  if (!t) return -1;
  const labels = opts.map((o) => [norm(o.ar), norm(o.en)].filter(Boolean));
  let i = labels.findIndex((ls) => ls.includes(t));
  if (i >= 0) return i;
  i = labels.findIndex((ls) => ls.some((l) => l.length >= 3 && t.includes(l)));
  if (i >= 0) return i;
  if (t.length < 3) return -1;
  const partial = labels.map((ls, j) => (ls.some((l) => l.includes(t)) ? j : -1)).filter((j) => j >= 0);
  return partial.length === 1 ? partial[0] : -1;
}
function periodOf(t: string): string | null {
  for (const p of ["afternoon", "evening", "morning"]) if (PERIOD_WORDS[p].some((w) => t.includes(norm(w)))) return p;
  return null;
}
/** A person's name: letters only, one to four words, no question. */
export function looksLikeName(text: string): boolean {
  const v = (text ?? "").trim();
  return v.length >= 2 && v.length <= 40 && !/[?؟]/.test(v) && /^[\p{L}\p{M}\s.'-]+$/u.test(v) && v.split(/\s+/).length <= 4;
}

/** The answer to the intake question being asked, if this message is one. */
function intakeAnswer(ctx: Ctx, st: State, lang: Lang, text: string, id: string | null, found: Intent[]): Result | null {
  const t = norm(text);
  if (st.step === "filter") {
    const s = ctx.services.find((x) => x.code === st.service);
    const opts = s ? filterOptions(s) : [];
    const i = id?.startsWith("opt:") ? Number(id.slice(4)) : id ? -1 : matchOption(t, opts);
    return i >= 0 && opts[i] ? nextIntake(ctx, { ...st, filter: opts[i].ar }, lang) : null;
  }
  if (st.step === "visit") {
    const v = id === "visit:first" || (!id && /(^|\s)(اول|first|new)(\s|$)/.test(t)) ? "first"
      : id === "visit:follow_up" || (!id && /(متابع|follow)/.test(t)) ? "follow_up" : null;
    return v ? nextIntake(ctx, { ...st, visit: v }, lang) : null;
  }
  if (st.step === "period") {
    const p = id?.startsWith("period:") ? id.slice(7) : id ? null : periodOf(t);
    return p && T.periods[p] ? nextIntake(ctx, { ...st, period: p }, lang) : null;
  }
  if (st.step === "name") {
    if (id || found.length || !looksLikeName(text) || findFaq(text, ctx.faqs, st.service)) return null;
    return nextIntake(ctx, { ...st, name: text.trim().replace(/\s+/g, " ") }, lang);
  }
  return null;
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

  const intake = isIntakeFlow(ctx);
  const medicalText = pick(lang, ctx.settings.medical_ar, ctx.settings.medical_en) ?? L(T.medical, lang);

  // 1. People and safety first.
  if (id === "human" || has("human")) return withAi(handoff(ctx, st, lang, "asked_human"));
  const urgent = text ? findFaq(text, ctx.faqs.filter((f) => f.handoff === "urgent"), st.service) : null;
  if (urgent || has("emergency")) {
    const s = ctx.services.find((x) => x.code === st.service) ?? null;
    return withAi(handoff(ctx, st, lang, "emergency", urgent ? faqAnswer(urgent, lang, s) : pick(lang, ctx.settings.emergency_ar, ctx.settings.emergency_en) ?? L(T.emergency, lang)));
  }
  if (has("complaint")) return withAi(handoff(ctx, st, lang, "complaint", L(T.complaint, lang)));
  if (has("medication")) return withAi(handoff(ctx, st, lang, "medical_question", medicalText));

  // 2. The intake question being asked.
  if (INTAKE_STEPS.includes(st.step as Step)) {
    const r = intakeAnswer(ctx, st, lang, text, id, found);
    if (r) return withAi(r);
  }
  // A condition or symptom ("I'm pregnant", "I have diabetes") goes to a person — unless the client approved an answer for it.
  const approved = text ? findFaq(text, ctx.faqs.filter((f) => f.handoff !== "urgent"), findService(text, ctx.services)?.code ?? st.service) : null;
  const wantsBooking = has("book") && Boolean(findService(text, ctx.services));   // "عايزة احجز متابعة حمل" is a booking, not a question
  if (has("medical") && !approved && !wantsBooking) return withAi(handoff(ctx, st, lang, "medical_question", medicalText));

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
    if (phone) return st.name ? finishIntake(ctx, st, lang, phone) : confirmBooking(ctx, st, lang, phone);
    const n = (st.unknown ?? 0) + 1;
    if (n >= ctx.settings.max_unknown + 1) return handoff(ctx, { ...st, unknown: n }, lang, "not_understood");
    return { say: [{ kind: "text", body: L(T.badPhone, lang) }], state: { ...st, lang, unknown: n }, status: "bot" };
  }

  // 3. Buttons.
  if (id === "menu") return { say: [menu(ctx, lang)], state: { ...st, lang, step: "menu", unknown: 0 }, status: "bot" };
  if (id?.startsWith("svc:")) {
    const s = ctx.services.find((x) => x.code === id.slice(4));
    if (s && intake) return startIntake(ctx, st, lang, s);
    if (s) return { say: [serviceCard(s, lang)], state: { ...st, lang, step: "service", service: s.code, unknown: 0 }, status: "bot", serviceCode: s.code };
  }
  if (id === "book" && intake) {
    const s = ctx.services.find((x) => x.code === st.service);
    return s ? startIntake(ctx, st, lang, s) : { say: [menu(ctx, lang)], state: { ...st, lang, step: "menu", unknown: 0 }, status: "bot" };
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
  const asking = inIntake(st);   // in the middle of the intake: answer, then ask the same question again
  const sameIntake = asking && current?.code === st.service;
  const followUp = (): Out => (asking ? intakeQuestion(ctx, st, lang) : null) ?? afterService(lang);
  const keep = (svc: Service): State => (asking ? { ...st, lang, unknown: 0 } : { ...st, lang, step: "service", service: svc.code, unknown: 0 });

  // An approved answer to this exact question comes before the generic price / booking replies
  // (but a bare service name opens the service, unless the answer belongs to that same service).
  const answerable = ctx.faqs.filter((f) => f.handoff !== "urgent");
  const faq = findFaq(text, answerable, current?.code) ?? (ctx.hint?.faq != null ? ctx.faqs[ctx.hint.faq] ?? null : null);
  if (faq && faq.handoff !== "urgent" && !(byText && st.step !== "service" && !asking && faq.service_code !== byText.code)) {
    // An answer that belongs to a specialty ("عندي سكر" → nutrition) also tells us the specialty.
    const target = current ?? (faq.service_code ? ctx.services.find((x) => x.code === faq.service_code) ?? null : null);
    const answer: Out = { kind: "text", body: faqAnswer(faq, lang, target) };
    const intro: Out[] = st.step === "start" ? [{ kind: "text", body: greeting(ctx, lang) }] : [];
    if (faq.handoff === "yes") return withAi({ ...handoff(ctx, { ...st, service: target?.code ?? st.service }, lang, "faq", answer.body), ...(cc ? { campaignCode: cc } : {}) });
    if (faq.handoff === "after_filter" && intake && target && !(asking && target.code === st.service)) return withAi(startIntake(ctx, st, lang, target, [...intro, answer], cc));
    return withAi({ say: [...intro, answer, followUp()],
      state: asking ? { ...st, lang, unknown: 0 } : { ...st, lang, step: target ? "service" : "menu", service: target?.code ?? st.service, unknown: 0, cc: cc ?? st.cc },
      status: "bot", ...(target ? { serviceCode: target.code } : {}), ...(cc ? { campaignCode: cc } : {}) });
  }
  if (has("book") && current) {
    if (intake) return withAi(sameIntake ? { say: [intakeQuestion(ctx, st, lang)!], state: { ...st, lang, unknown: 0 }, status: "bot" } : startIntake(ctx, st, lang, current, [], cc));
    return withAi(startBooking(ctx, { ...st, service: current.code, cc: cc ?? st.cc }, lang));
  }
  if ((has("price") || has("duration")) && current) {
    const v = has("price") ? (lang === "ar" ? current.price_ar : current.price_en) : (lang === "ar" ? current.duration_ar : current.duration_en);
    if (!v) return withAi(handoff(ctx, { ...st, service: current.code }, lang, "price_unknown", L(T.noPrice, lang)));
    return withAi({ say: [{ kind: "text", body: `${L(has("price") ? T.price : T.duration, lang)} — ${svcName(current, lang)}: ${v}` }, followUp()],
      state: keep(current), status: "bot", serviceCode: current.code });
  }
  if (byText && intake) {
    if (sameIntake) return withAi({ say: [intakeQuestion(ctx, st, lang)!], state: { ...st, lang, unknown: 0 }, status: "bot" });
    const intro = st.step === "start" ? greeting(ctx, lang) : null;
    return withAi(startIntake(ctx, st, lang, byText, intro ? [{ kind: "text", body: intro }] : [], cc));
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
