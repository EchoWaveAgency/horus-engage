import { requireOrg } from "@/lib/session";
import { Submit } from "@/components/ui";
import { Banner } from "@/components/bits";
import { saveFaq, saveService } from "@/app/actions/inbox";

export const metadata = { title: "Services & answers" };
export const dynamic = "force-dynamic";
type S = { id: string; code: string; name_ar: string; name_en: string; summary_ar: string; summary_en: string; offer_ar: string | null; offer_en: string | null;
  price_ar: string | null; price_en: string | null; duration_ar: string | null; duration_en: string | null; booking_mode: string; keywords: string[];
  campaign_codes: string[]; sort: number; is_active: boolean;
  filter_question_ar: string | null; filter_question_en: string | null; filter_options: { ar: string; en: string }[] };
type F = { id: string; service_id: string | null; question_ar: string; question_en: string; answer_ar: string; answer_en: string; keywords: string[]; is_active: boolean;
  handoff: string };
const HANDOFF: Record<string, { ar: string; en: string }> = {
  no: { ar: "لأ — البوت يكمّل", en: "No — the bot carries on" },
  after_filter: { ar: "بعد الفلترة — يرد ويكمّل أسئلة الحجز", en: "After the filter — answer, then the booking questions" },
  yes: { ar: "آه — يرد ويحوّل لموظفة", en: "Yes — answer, then a person" },
  urgent: { ar: "فوراً — طوارئ", en: "At once — emergency" },
};

export default async function Services({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const ctx = await requireOrg(["owner", "admin"]);
  const ar = ctx.ar;
  const [{ data: services }, { data: faqs }] = await Promise.all([
    ctx.supabase.from("services").select("*").eq("org_id", ctx.org.id).order("sort").order("code").returns<S[]>(),
    ctx.supabase.from("faqs").select("*").eq("org_id", ctx.org.id).order("updated_at", { ascending: false }).returns<F[]>(),
  ]);
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">{ar ? "الخدمات والردود المعتمدة" : "Services & approved answers"}</h1>
      <p className="muted mb-4 text-sm">{ar ? "البوت لا يقول إلا المكتوب هنا. لو السعر فاضي، البوت يحوّل العميل لموظف بدل ما يخمّن. أي خانة بين [ ] لازم تتملى قبل ما الرد يشتغل." : "The bot only says what is written here. Leave the price empty and the bot hands the customer to a person instead of guessing. Anything in [ ] must be filled before the answer can be switched on."}</p>
      <Banner ar={ar} ok={searchParams.ok} error={searchParams.error} />
      <div className="space-y-3">
        {(services ?? []).map((s) => <ServiceForm key={s.id} s={s} ar={ar} />)}
        <ServiceForm ar={ar} />
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">{ar ? "أسئلة متكررة" : "FAQs"}</h2>
      <div className="space-y-3">
        {(faqs ?? []).map((f) => <FaqForm key={f.id} f={f} services={services ?? []} ar={ar} />)}
        <FaqForm services={services ?? []} ar={ar} />
      </div>
    </>
  );
}

function ServiceForm({ s, ar }: { s?: S; ar: boolean }) {
  const t = (k: keyof S) => (s?.[k] as string | null) ?? "";
  return (
    <details className="card" open={!s}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        {s ? <><span className="num font-bold text-gold-300">{s.code}</span><span>{ar ? s.name_ar : s.name_en}</span>
          {!s.price_ar && <span className="chip bg-coal-600 text-ivory-300">{ar ? "بدون سعر معتمد" : "no approved price"}</span>}
          <span className={`chip ms-auto ${s.is_active ? "bg-emerald-500/20 text-emerald-200" : "bg-coal-600"}`}>{s.is_active ? (ar ? "نشطة" : "Active") : (ar ? "متوقفة" : "Off")}</span></>
          : <span className="font-semibold text-gold-100">{ar ? "+ خدمة جديدة" : "+ New service"}</span>}
      </summary>
      <form action={saveService} className="grid gap-3 border-t border-coal-600 p-4 sm:grid-cols-2">
        {s && <input type="hidden" name="id" value={s.id} />}
        <label><span className="label">{ar ? "الكود" : "Code"}</span><input name="code" required defaultValue={t("code")} placeholder="LASER" className="input num" /></label>
        <label><span className="label">{ar ? "الترتيب في القائمة" : "Menu order"}</span><input name="sort" type="number" defaultValue={s?.sort ?? 100} className="input num" /></label>
        <label><span className="label">{ar ? "الاسم بالعربي" : "Arabic name"}</span><input name="name_ar" required defaultValue={t("name_ar")} className="input" /></label>
        <label><span className="label">{ar ? "الاسم بالإنجليزي" : "English name"}</span><input name="name_en" required defaultValue={t("name_en")} className="input" dir="ltr" /></label>
        <label className="sm:col-span-2"><span className="label">{ar ? "الوصف المعتمد (عربي)" : "Approved description (Arabic)"}</span><textarea name="summary_ar" required rows={2} defaultValue={t("summary_ar")} className="input" /></label>
        <label className="sm:col-span-2"><span className="label">{ar ? "الوصف (إنجليزي)" : "Description (English)"}</span><textarea name="summary_en" rows={2} defaultValue={t("summary_en")} className="input" dir="ltr" /></label>
        <label><span className="label">{ar ? "العرض الحالي" : "Current offer"}</span><input name="offer_ar" defaultValue={t("offer_ar")} className="input" /></label>
        <label><span className="label">Offer (EN)</span><input name="offer_en" defaultValue={t("offer_en")} className="input" dir="ltr" /></label>
        <label><span className="label">{ar ? "السعر المعتمد (فاضي = البوت يحوّل لموظف)" : "Approved price (empty = hand to a person)"}</span><input name="price_ar" defaultValue={t("price_ar")} className="input" /></label>
        <label><span className="label">Price (EN)</span><input name="price_en" defaultValue={t("price_en")} className="input" dir="ltr" /></label>
        <label><span className="label">{ar ? "المدة" : "Duration"}</span><input name="duration_ar" defaultValue={t("duration_ar")} className="input" /></label>
        <label><span className="label">Duration (EN)</span><input name="duration_en" defaultValue={t("duration_en")} className="input" dir="ltr" /></label>
        <label className="sm:col-span-2"><span className="label">{ar ? "كلمات يعرف بيها البوت الخدمة (فاصلة بين كل كلمة)" : "Keywords the bot recognises (comma separated)"}</span><input name="keywords" defaultValue={s?.keywords.join("، ")} className="input" /></label>
        <label><span className="label">{ar ? "أكواد الحملات (مثل GF26-LASER)" : "Campaign codes (e.g. GF26-LASER)"}</span><input name="campaign_codes" defaultValue={s?.campaign_codes.join(", ")} className="input num" /></label>
        <label><span className="label">{ar ? "الحجز" : "Booking"}</span>
          <select name="booking_mode" defaultValue={s?.booking_mode ?? "request"} className="input">
            <option value="request">{ar ? "البوت يسجّل طلب الحجز (يوم + وقت) والفريق يأكده" : "Bot takes the booking request (day + time); the team confirms"}</option>
            <option value="human_only">{ar ? "الحجز مع موظف فقط" : "Booked by a person only"}</option>
          </select></label>
        <label><span className="label">{ar ? "سؤال الفلترة (اختياري — بيتسأل بعد اختيار الخدمة)" : "Filter question (optional — asked after the service is chosen)"}</span>
          <input name="filter_question_ar" defaultValue={t("filter_question_ar")} placeholder="تمام. إيه الأقرب لحالتك؟" className="input" /></label>
        <label><span className="label">Filter question (EN)</span><input name="filter_question_en" defaultValue={t("filter_question_en")} className="input" dir="ltr" /></label>
        <label className="sm:col-span-2"><span className="label">{ar ? "اختيارات الفلترة — كل سطر اختيار: عربي | English (لحد 10، 24 حرف)" : "Filter options — one per line: Arabic | English (up to 10, 24 characters)"}</span>
          <textarea name="filter_options" rows={5} defaultValue={(s?.filter_options ?? []).map((o) => `${o.ar} | ${o.en}`).join("\n")} className="input" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={s?.is_active ?? true} />{ar ? "نشطة" : "Active"}</label>
        <Submit className="btn-gold sm:col-span-2">{ar ? "حفظ" : "Save"}</Submit>
      </form>
    </details>
  );
}

function FaqForm({ f, services, ar }: { f?: F; services: S[]; ar: boolean }) {
  return (
    <details className="card" open={!f}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">{f ? <><span>{ar ? f.question_ar : f.question_en}</span>
        {f.handoff !== "no" && <span className={`chip ${f.handoff === "urgent" ? "bg-red-500/20 text-red-200" : "bg-coal-600 text-ivory-300"}`}>{ar ? HANDOFF[f.handoff]?.ar.split(" — ")[0] : HANDOFF[f.handoff]?.en.split(" — ")[0]}</span>}
        <span className={`chip ms-auto ${f.is_active ? "bg-emerald-500/20 text-emerald-200" : "bg-coal-600"}`}>{f.is_active ? (ar ? "نشط" : "Active") : (ar ? "متوقف" : "Off")}</span></>
        : <span className="font-semibold text-gold-100">{ar ? "+ سؤال جديد" : "+ New FAQ"}</span>}</summary>
      <form action={saveFaq} className="grid gap-3 border-t border-coal-600 p-4 sm:grid-cols-2">
        {f && <input type="hidden" name="id" value={f.id} />}
        <label><span className="label">{ar ? "السؤال" : "Question"}</span><input name="question_ar" required defaultValue={f?.question_ar} className="input" /></label>
        <label><span className="label">{ar ? "الخدمة (اختياري)" : "Service (optional)"}</span>
          <select name="service_id" defaultValue={f?.service_id ?? ""} className="input"><option value="">{ar ? "عام" : "General"}</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="label">{ar ? "الرد المعتمد" : "Approved answer"}</span><textarea name="answer_ar" required rows={2} defaultValue={f?.answer_ar} className="input" /></label>
        <label className="sm:col-span-2"><span className="label">Answer (EN)</span><textarea name="answer_en" rows={2} defaultValue={f?.answer_en} className="input" dir="ltr" /></label>
        <label className="sm:col-span-2"><span className="label">{ar ? "كلمات مفتاحية" : "Keywords"}</span><input name="keywords" required defaultValue={f?.keywords.join("، ")} className="input" /></label>
        <label><span className="label">{ar ? "يتحوّل للموظفة؟" : "Hand to a person?"}</span>
          <select name="handoff" defaultValue={f?.handoff ?? "no"} className="input">
            {Object.entries(HANDOFF).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={f?.is_active ?? true} />{ar ? "نشط" : "Active"}</label>
        <Submit className="btn-gold">{ar ? "حفظ" : "Save"}</Submit>
      </form>
    </details>
  );
}
