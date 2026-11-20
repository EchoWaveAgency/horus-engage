import { describe, expect, it } from "vitest";
import { step, mediaStep, nextDays, dayLabel, type Ctx, type Service, type State } from "./bot";
import { classifyComment, intents, normalizePhone, norm, campaignCode } from "./text";
import { planComment, pick, type CommentSettings } from "./comments";
import { messenger, whatsapp, plain } from "./render";

const svc = (code: string, extra: Partial<Service> = {}): Service => ({
  code, name_ar: { LASER: "إزالة الشعر بالليزر", DENTAL: "الأسنان", SKIN: "البشرة", CHECKUP: "فحص شامل" }[code] ?? code, name_en: code,
  summary_ar: `وصف ${code}`, summary_en: `About ${code}`, booking_mode: "request", keywords: [], campaign_codes: [`GF26-${code}`], ...extra,
});
const services = [
  svc("LASER", { keywords: ["ليزر", "laser"], offer_ar: "خصم 40% الجمعة الذهبية", price_ar: "من 500 جنيه للجلسة", duration_ar: "30 دقيقة" }),
  svc("DENTAL", { keywords: ["اسنان", "تبييض"] }),
  svc("SKIN", { keywords: ["بشره", "تنظيف بشره"] }),
  svc("CHECKUP", { keywords: ["فحص"], booking_mode: "human_only" }),
];
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  channel: "whatsapp", contact: { name: "Mariam Adel", phone: "+201001112233" }, services,
  faqs: [{ question_ar: "العنوان", question_en: "Address", answer_ar: "الشروق — المنطقة الثالثة", answer_en: "El Shorouk", keywords: ["العنوان", "فين", "address"] },
         { service_code: "LASER", question_ar: "هل الليزر بيوجع؟", question_en: "", answer_ar: "إحساس بسيط", answer_en: "", keywords: ["بيوجع"] }],
  settings: { greeting_ar: "أهلاً بيك 👋", greeting_en: "Hello 👋", handoff_ar: "هحوّلك لموظف", handoff_en: "A person will help", max_unknown: 2, ask_phone: true,
              after_hours_ar: "هنرد عليك أول ما نفتح الساعة 10", after_hours_en: null },
  today: "2026-11-27", inHours: true, ...over,
});
const body = (r: ReturnType<typeof step>) => r.say.map((o) => plain(o)).join("\n---\n");

describe("text", () => {
  it("normalizes Arabic", () => {
    expect(norm("إزالةُ الشّعر بالليزر ٣")).toBe("ازاله الشعر بالليزر 3");
  });
  it("finds intents in Egyptian Arabic and English", () => {
    expect(intents("عايز اكلم موظف")).toContain("human");
    expect(intents("بكام الجلسة؟")).toContain("price");
    expect(intents("عايزة احجز ميعاد")).toContain("book");
    expect(intents("أنا حامل ينفع؟")).toContain("medical");
    expect(intents("الخدمة كانت وحشة جدا")).toContain("complaint");
    expect(intents("how much is it")).toContain("price");
    expect(intents("شكراً")).toContain("thanks");
  });
  it("phones and campaign codes", () => {
    expect(normalizePhone("٠١٠٠١١١٢٢٣٣")).toBe("+201001112233");
    expect(normalizePhone("+20 100 111 2233")).toBe("+201001112233");
    expect(normalizePhone("12")).toBeNull();
    expect(campaignCode("مرحبا gf26 laser", ["GF26-LASER", "GF26-LASER-VIP"])).toBe("GF26-LASER");
  });
});

describe("first message", () => {
  it("campaign code from a Click-to-WhatsApp ad opens that service directly, greeting by name", () => {
    const r = step(ctx(), {}, { type: "text", text: "GF26-LASER عايزة اعرف العرض" });
    expect(r.state.step).toBe("service");
    expect(r.serviceCode).toBe("LASER");
    expect(r.campaignCode).toBe("GF26-LASER");
    expect(body(r)).toContain("أهلاً بيك يا Mariam");
    expect(body(r)).toContain("خصم 40%");
    expect(body(r)).toContain("من 500 جنيه");
    expect(r.say[1].kind).toBe("buttons");
  });
  it("a plain hello gets the greeting and the service menu (list for 4+ services)", () => {
    const r = step(ctx(), {}, { type: "text", text: "السلام عليكم" });
    expect(r.state.step).toBe("menu");
    expect(r.say[0].kind).toBe("list");
    expect(body(r)).toContain("أهلاً");
  });
  it("English customers get English", () => {
    const r = step(ctx(), {}, { type: "text", text: "Hello, do you do laser?" });
    expect(r.state.lang).toBe("en");
    expect(r.serviceCode).toBe("LASER");
  });
  it("a number picks from the menu", () => {
    const r = step(ctx(), { step: "menu" }, { type: "text", text: "٢" });
    expect(r.serviceCode).toBe("DENTAL");
  });
});

describe("answers only from approved content", () => {
  it("price from the approved text", () => {
    const r = step(ctx(), { step: "service", service: "LASER" }, { type: "text", text: "بكام؟" });
    expect(body(r)).toContain("من 500 جنيه للجلسة");
    expect(r.status).toBe("bot");
  });
  it("no approved price → hands off instead of guessing", () => {
    const r = step(ctx(), { step: "service", service: "DENTAL" }, { type: "text", text: "التبييض بكام" });
    expect(r.status).toBe("human");
    expect(r.handoffReason).toBe("price_unknown");
  });
  it("FAQ answers, service-specific first", () => {
    expect(body(step(ctx(), { step: "menu" }, { type: "text", text: "العنوان فين؟" }))).toContain("الشروق");
    expect(body(step(ctx(), { step: "service", service: "LASER" }, { type: "text", text: "هو بيوجع؟" }))).toContain("إحساس بسيط");
  });
});

describe("booking", () => {
  it("WhatsApp: book → day → period → request saved", () => {
    let st: State = { step: "service", service: "LASER", lang: "ar" };
    let r = step(ctx(), st, { type: "button", id: "book" });
    expect(r.state.step).toBe("book_day");
    expect(r.say[0].kind).toBe("list");
    st = r.state;
    r = step(ctx(), st, { type: "button", id: "day:2026-11-28" });
    expect(r.state.step).toBe("book_period");
    r = step(ctx(), r.state, { type: "button", id: "period:evening" });
    expect(r.booking).toEqual({ day: "2026-11-28", period: "evening", note: "LASER" });
    expect(r.state.step).toBe("done");
    expect(body(r)).toContain("بكرة 28/11");
    expect(body(r)).toContain("بالليل");
  });
  it("Messenger without a phone: asks for it, validates, then books", () => {
    const c = ctx({ channel: "messenger", contact: { name: "Sara" } });
    let r = step(c, { step: "book_period", service: "SKIN", day: "2026-11-29" }, { type: "button", id: "period:morning" });
    expect(r.state.step).toBe("ask_phone");
    r = step(c, r.state, { type: "text", text: "رقمي ١٢٣" });
    expect(body(r)).toContain("01xxxxxxxxx");
    r = step(c, r.state, { type: "text", text: "رقمي 01112223344" });
    expect(r.contact?.phone).toBe("+201112223344");
    expect(r.booking?.period).toBe("morning");
  });
  it("services booked only by people hand off", () => {
    const r = step(ctx(), { step: "service", service: "CHECKUP" }, { type: "text", text: "عايز احجز" });
    expect(r.status).toBe("human");
    expect(r.handoffReason).toBe("booking_human");
  });
  it("a day outside the next week is refused", () => {
    const r = step(ctx(), { step: "book_day", service: "LASER" }, { type: "button", id: "day:2027-01-01" });
    expect(r.state.step).toBe("book_day");
  });
  it("day labels", () => {
    expect(nextDays("2026-11-27", 3)).toEqual(["2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(dayLabel("2026-11-30", "2026-11-27", "ar")).toBe("الاثنين 30/11");
    expect(dayLabel("2026-11-27", "2026-11-27", "en")).toBe("Today 27/11");
  });
});

describe("handoff to the call center", () => {
  it("on request, at any step", () => {
    const r = step(ctx(), { step: "book_day", service: "LASER" }, { type: "text", text: "عايز اكلم حد" });
    expect(r.status).toBe("human");
    expect(r.handoffReason).toBe("asked_human");
    expect(step(ctx(), {}, { type: "button", id: "human" }).status).toBe("human");
  });
  it("medical questions and complaints are never answered by the bot", () => {
    expect(step(ctx(), { step: "service", service: "LASER" }, { type: "text", text: "أنا حامل في الشهر الرابع ينفع ليزر؟" }).handoffReason).toBe("medical_question");
    expect(step(ctx(), { step: "menu" }, { type: "text", text: "انتو نصابين ومحدش رد عليا" }).handoffReason).toBe("complaint");
  });
  it("after two messages it does not understand", () => {
    let r = step(ctx(), { step: "menu" }, { type: "text", text: "زززز" });
    expect(r.status).toBe("bot");
    r = step(ctx(), r.state, { type: "text", text: "قققق" });
    expect(r.status).toBe("human");
    expect(r.handoffReason).toBe("not_understood");
  });
  it("tells the customer when the team is off", () => {
    const r = step(ctx({ inHours: false }), {}, { type: "button", id: "human" });
    expect(body(r)).toContain("أول ما نفتح");
  });
  it("voice notes / images go to a person", () => {
    expect(mediaStep(ctx(), {}).handoffReason).toBe("media");
  });
});

describe("language-model hint", () => {
  it("is used only when the rules found nothing, and only to pick a known service/intent", () => {
    const r = step(ctx({ hint: { intent: "other", service: "SKIN" } }), { step: "menu" }, { type: "text", text: "وشي مليان حبوب وعايز حاجة تنضفه" });
    expect(r.serviceCode).toBe("SKIN");
    expect(r.usedAi).toBe(true);
    const r2 = step(ctx({ hint: { intent: "human" } }), { step: "menu" }, { type: "text", text: "ممكن حد بشري" });
    expect(r2.status).toBe("human");
    const r3 = step(ctx({ hint: { intent: "thanks", service: "NOPE" } }), { step: "service", service: "LASER" }, { type: "text", text: "عايز احجز" });
    expect(r3.state.step).toBe("book_day");   // rules win
  });
});

describe("channel payloads", () => {
  it("WhatsApp buttons and lists within limits", () => {
    const b = whatsapp({ kind: "buttons", body: "x", buttons: [{ id: "book", title: "احجز الآن بخصم الجمعة الذهبية" }] }) as { interactive: { action: { buttons: { reply: { title: string } }[] } } };
    expect(b.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
    const l = whatsapp({ kind: "list", body: "x", button: "الخدمات", rows: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, title: `خدمة ${i}` })) }) as { interactive: { action: { sections: { rows: unknown[] }[] } } };
    expect(l.interactive.action.sections[0].rows).toHaveLength(10);
  });
  it("Messenger quick replies", () => {
    const m = messenger({ kind: "buttons", body: "*ليزر*\nوصف", buttons: [{ id: "book", title: "احجز" }] }) as { text: string; quick_replies: { payload: string }[] };
    expect(m.quick_replies[0].payload).toBe("book");
    expect(m.text).toBe("ليزر\nوصف");
    expect((whatsapp({ kind: "text", body: "*ليزر*" }) as { text: { body: string } }).text.body).toBe("*ليزر*");
  });
});

describe("comments", () => {
  const S: CommentSettings = { comment_public_reply: true, comment_private_reply: true, comment_hide_spam: true, comment_escalate: true,
    comment_thank_positive: true, comment_replies_ar: ["بعتنالك في الخاص 💬", "شوف رسايلك ✨"], comment_replies_en: ["Check your inbox"],
    comment_thanks_ar: ["شكرًا 🤍"], comment_thanks_en: ["Thanks"], comment_complaint_ar: "نأسف…", comment_complaint_en: "Sorry…" };
  it("classifies", () => {
    expect(classifyComment("بكام؟")).toBe("price");
    expect(classifyComment("تم")).toBe("inquiry");
    expect(classifyComment("عايزة التفاصيل")).toBe("inquiry");
    expect(classifyComment("تحفة ❤️")).toBe("positive");
    expect(classifyComment("اربح 5000 يوميا ادخل https://x.co")).toBe("spam");
    expect(classifyComment("انتو حراميه")).toBe("abuse");
    expect(classifyComment("اسوأ تجربة في حياتي")).toBe("complaint");
    expect(classifyComment("@sara @mona")).toBe("other");
  });
  it("inquiry → public reply + menu DM; spam → hidden; complaint → apology DM + person; positive → thanks", () => {
    expect(planComment("بكام الليزر؟", "c1", S)).toMatchObject({ publicReply: expect.any(String), privateReply: true, privateMode: "menu", status: "auto_handled" });
    expect(planComment("ربح يومي من البيت تابعني", "c2", S)).toMatchObject({ hide: true, publicReply: null, privateReply: false });
    expect(planComment("خدمة سيئة جدا", "c3", S)).toMatchObject({ privateMode: "complaint", status: "needs_human", publicReply: "نأسف…" });
    expect(planComment("ربنا يوفقكم", "c4", S)).toMatchObject({ publicReply: "شكرًا 🤍", privateReply: false });
    expect(planComment("ربنا يوفقكم", "c4", S, { isReply: true }).publicReply).toBeNull();
  });
  it("no DM after 7 days (Meta rule) → a person follows up", () => {
    expect(planComment("بكام", "c5", S, { ageDays: 8 })).toMatchObject({ privateReply: false, publicReply: null, status: "needs_human" });
  });
  it("public replies vary but stay stable per comment", () => {
    expect(pick(S.comment_replies_ar, "abc")).toBe(pick(S.comment_replies_ar, "abc"));
    const seen = new Set(["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => pick(S.comment_replies_ar, id)));
    expect(seen.size).toBe(2);
  });
});
