// Golden Care's approved script ("أسئلة البوت وردوده لكل تخصص", 2026-11-21) run through the engine, end to end.
import { describe, expect, it } from "vitest";
import content from "../../../scripts/clients/golden-care.json";
import { step, looksLikeName, type Ctx, type Event, type Faq, type Result, type Service, type Settings, type State } from "./bot";
import { campaignCode } from "./text";
import { plain, whatsapp } from "./render";

const services: Service[] = content.services.map((s) => ({
  code: s.code, name_ar: s.name_ar, name_en: s.name_en, summary_ar: s.name_ar, summary_en: s.name_en, booking_mode: "request",
  keywords: s.keywords, campaign_codes: s.campaign_codes, filter_question_ar: s.filter_question_ar ?? null,
  filter_question_en: s.filter_question_en ?? null, filter_options: s.filter_options ?? [],
}));
// Only what the loader would make active (no unfilled [placeholders]).
const faqs: Faq[] = content.faqs.filter((f) => f.active).map((f) => ({
  service_code: f.service, question_ar: f.question_ar, question_en: f.question_en, answer_ar: f.answer_ar, answer_en: f.answer_en,
  keywords: f.keywords, handoff: f.handoff as Faq["handoff"],
}));
const settings: Settings = { greeting_ar: "أهلاً بيك في Golden Care 👋", greeting_en: "Welcome to Golden Care 👋", max_unknown: 2, ask_phone: true,
  ...(content.settings as Partial<Settings>), handoff_ar: content.settings.handoff_ar, handoff_en: content.settings.handoff_en };
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ channel: "whatsapp", contact: { name: "Mona", phone: "+201001112233" }, services, faqs, settings,
  today: "2026-11-21", inHours: true, ...over });
const text = (t: string): Event => ({ type: "text", text: t });
const tap = (id: string): Event => ({ type: "button", id });
const said = (r: Result) => r.say.map((o) => plain(o)).join("\n---\n");
function talk(c: Ctx, events: Event[], from: State = {}) {
  let st = from; const out: Result[] = [];
  for (const e of events) { const r = step(c, st, e); out.push(r); st = r.state; if (r.status === "human") break; }
  return out;
}

describe("Golden Care intake (the three fixed questions)", () => {
  it("ad code D1 → dental filter → first visit → evening → name → handed to customer service with the booking request", () => {
    const [r1, r2, r3, r4, r5] = talk(ctx(), [text("D1 عايز استفسر"), tap("opt:0"), tap("visit:first"), tap("period:evening"), text("مني أحمد")]);
    expect(r1.serviceCode).toBe("DENTAL");
    expect(r1.campaignCode).toBe("D1");
    expect(said(r1)).toContain("أهلاً بيك");
    expect(said(r1)).toContain("تمام. إيه الأقرب لحالتك؟");
    expect(r1.say.at(-1)!.kind).toBe("list");                       // 5 options → WhatsApp list
    expect(said(r2)).toContain("ده أول كشف ليك عندنا ولا متابعة؟");
    expect(said(r3)).toContain("الوقت الأنسب ليك؟");
    expect(said(r3)).toContain("بعد الضهر");
    expect(said(r4)).toContain("آخر سؤال: اسمك الكريم؟");
    expect(r5.status).toBe("human");
    expect(r5.handoffReason).toBe("intake_done");
    expect(said(r5)).toBe("شكراً يا مني أحمد. زميلتنا في خدمة العملاء هتكمّل معاك هنا في أقرب وقت، وهتأكد معاك الميعاد والدكتور المناسب.");
    expect(r5.booking).toEqual({ day: null, period: "evening", note: "DENTAL · ألم أو ضرس مكسور · أول مرة · بالليل · مني أحمد · D1" });
    expect(r5.contact).toMatchObject({ name: "مني أحمد" });
  });
  it("typed answers work too (no buttons)", () => {
    const rs = talk(ctx(), [text("L1"), text("ليزر"), text("متابعه"), text("الصبح"), text("Sara Ali")]);
    expect(rs.at(-1)!.booking?.note).toBe("DERMA · ليزر إزالة شعر · متابعة · الصبح · Sara Ali · L1");
  });
  it("specialties without a filter question go straight to the fixed questions", () => {
    const r = step(ctx(), { step: "menu" }, tap("svc:ORTHO"));
    expect(r.state.step).toBe("visit");
    expect(said(r)).toContain("ده أول كشف ليك عندنا ولا متابعة؟");
  });
  it("the menu lists all ten specialties", () => {
    const r = step(ctx(), {}, text("السلام عليكم"));
    expect(r.say.at(-1)!.kind).toBe("list");
    const rows = (whatsapp(r.say.at(-1)!) as { interactive: { action: { sections: { rows: { title: string }[] }[] } } }).interactive.action.sections[0].rows;
    expect(rows.map((x) => x.title)).toEqual(services.map((s) => s.name_ar));
  });
  it("Messenger without a phone: asks for the number after the name", () => {
    const c = ctx({ channel: "messenger", contact: { name: "Mona" } });
    const rs = talk(c, [tap("svc:INTERNAL"), tap("visit:follow_up"), tap("period:morning"), text("منى"), text("01112223344")]);
    expect(said(rs[3])).toContain("رقم موبايلك");
    expect(rs[4].handoffReason).toBe("intake_done");
    expect(rs[4].contact).toMatchObject({ name: "منى", phone: "+201112223344" });
  });
  it("a question in the middle is answered, then the same question is asked again", () => {
    const st: State = { step: "name", service: "DERMA", filter: "ليزر إزالة شعر", visit: "first", period: "evening", lang: "ar" };
    const r = step(ctx(), st, text("هو الليزر بيوجع؟"));
    expect(r.status).toBe("bot");
    expect(said(r)).toContain("لسعة خفيفة");
    expect(said(r)).toContain("اسمك الكريم");
    expect(r.state.step).toBe("name");
  });
  it("a name is never taken from a question or an intent", () => {
    expect(looksLikeName("محمد علي")).toBe(true);
    expect(looksLikeName("بكام؟")).toBe(false);
    expect(looksLikeName("01001112233")).toBe(false);
    const r = step(ctx(), { step: "name", service: "INTERNAL", visit: "first", period: "morning" }, text("بكام الكشف"));
    expect(r.state.name).toBeUndefined();
  });
  it("short ad codes only match as whole codes", () => {
    expect(campaignCode("D1 عايز احجز", ["D1", "L1", "N1"])).toBe("D1");
    expect(campaignCode("رقمي 01D10", ["D1"])).toBeNull();
    expect(campaignCode("SD1", ["D1"])).toBeNull();
  });
});

describe("Golden Care FAQs and what happens after them", () => {
  it("'after the filter' answers: answer, then the specialty's filter question", () => {
    const r = step(ctx(), {}, text("ضرسي مكسور لازم اخلعه؟"));
    expect(said(r)).toContain("مش شرط");
    expect(said(r)).toContain("إيه الأقرب لحالتك؟");
    expect(r.state.step).toBe("filter");
    expect(r.serviceCode).toBe("DENTAL");
  });
  it("a condition the clinic approved an answer for is answered, not handed off (عندي سكر → nutrition)", () => {
    const r = step(ctx(), {}, text("عندي سكر وعايز نظام"));
    expect(r.status).toBe("bot");
    expect(said(r)).toContain("التغذية العلاجية بتراعي الحالات دي");
    expect(r.state.step).toBe("filter");
  });
  it("'yes' answers: answer, then a person (laser while pregnant)", () => {
    const r = step(ctx(), { step: "filter", service: "DERMA" }, text("ينفع لو انا حامل؟"));
    expect(r.status).toBe("human");
    expect(r.handoffReason).toBe("faq");
    expect(said(r)).toContain("ده محتاج رأي الدكتورة شخصياً");
  });
  it("changing an appointment goes to a person, not into a new booking", () => {
    const r = step(ctx(), {}, text("عايز اغير ميعادي"));
    expect(r.status).toBe("human");
    expect(said(r)).toContain("هتغيّرلك الميعاد");
  });
  it("a specialty-specific answer wins over the generic price reply", () => {
    const r = step(ctx(), { step: "service", service: "SURGERY" }, text("سعر العملية كام؟"));
    expect(said(r)).toContain("بيتحدد بعد الكشف حسب نوع العملية والمستشفى");
  });
  it("no approved price → a person, never a guessed number", () => {
    const r = step(ctx(), { step: "service", service: "DENTAL" }, text("سعر الحشو؟"));
    expect(r.status).toBe("human");
    expect(r.handoffReason).toBe("price_unknown");
    expect(said(r)).not.toMatch(/\[|\d+ جنيه/);
  });
});

describe("Golden Care safety", () => {
  it("emergency words → go to the nearest emergency room, handed over at once, at any step", () => {
    const r = step(ctx(), { step: "name", service: "INTERNAL" }, text("مش قادر اتنفس"));
    expect(r.status).toBe("human");
    expect(r.handoffReason).toBe("emergency");
    expect(said(r)).toContain("اتوجّه لأقرب طوارئ فوراً");
  });
  it("specialty emergency answers are used when they match (pregnant + bleeding)", () => {
    const r = step(ctx(), { step: "filter", service: "GYN" }, text("عندي نزيف وانا حامل"));
    expect(r.handoffReason).toBe("emergency");
    expect(said(r)).toContain("اتوجهي لأقرب طوارئ فوراً");
  });
  it("orthopaedic fall, neuro warning signs, severe tooth pain", () => {
    expect(said(step(ctx(), {}, text("وقعت ومش عارف احرك رجلي")))).toContain("احتمال كسر");
    expect(step(ctx(), {}, text("صداع مفاجئ شديد")).handoffReason).toBe("emergency");
    expect(said(step(ctx(), { step: "filter", service: "DENTAL" }, text("عندي وجع جامد دلوقتي")))).toContain("هنحاول نلاقيلك أقرب ميعاد");
  });
  it("medicine / dose / diagnosis questions → the clinic's medical reply and a person", () => {
    const r = step(ctx(), { step: "visit", service: "INTERNAL" }, text("اخد دوا ايه للصداع؟"));
    expect(r.handoffReason).toBe("medical_question");
    expect(said(r)).toContain("سؤالك مهم، والإجابة عليه محتاجة الدكتور يشوف الحالة بنفسه");
  });
  it("a condition with no approved answer still goes to a person", () => {
    expect(step(ctx(), { step: "service", service: "PLASTIC" }, text("عندي حساسية من البنج")).handoffReason).toBe("medical_question");
  });
  it("asking for a person works mid-intake", () => {
    const r = step(ctx(), { step: "period", service: "DENTAL" }, text("عايز اكلم خدمة العملاء"));
    expect(r.handoffReason).toBe("asked_human");
    expect(said(r)).toBe("شكراً. زميلتنا في خدمة العملاء هتكمّل معاك هنا في أقرب وقت.");
  });
  it("'مشكلة جلدية' is a filter answer, not a complaint; 'عايزة احجز متابعة حمل' is a booking", () => {
    expect(step(ctx(), { step: "filter", service: "DERMA" }, text("مشكلة جلدية")).state.filter).toBe("مشكلة جلدية");
    const r = step(ctx(), {}, text("عايزة احجز متابعة حمل"));
    expect(r.status).toBe("bot");
    expect(r.serviceCode).toBe("GYN");
  });
  it("never states an unfilled [placeholder]", () => {
    for (const t of ["العيادة فين؟", "مواعيدكم ايه", "فيه عروض؟", "بتقبلوا تأمين؟", "الدفع ازاي", "فيه ركنة؟", "مين الدكتور؟"]) {
      expect(said(step(ctx(), {}, text(t)))).not.toContain("[");
    }
  });
});
