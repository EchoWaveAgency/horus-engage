import { headers } from "next/headers";
import { requireOrg } from "@/lib/session";
import { Submit } from "@/components/ui";
import { Banner } from "@/components/bits";
import { rotateSecret, saveSettings } from "@/app/actions/inbox";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: { ok?: string; error?: string; show?: string } }) {
  const ctx = await requireOrg(["owner", "admin"]);
  const ar = ctx.ar;
  const { data: s } = await ctx.supabase.from("bot_settings").select("*").eq("org_id", ctx.org.id).single();
  const secret = ctx.role === "owner" && searchParams.show ? (await ctx.supabase.rpc("org_integration_secret", { p_org: ctx.org.id })).data as string : null;
  const h = headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const box = (name: string, a: string, e: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={s?.[name]} className="mt-1" /><span>{ar ? a : e}</span></label>
  );
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">{ar ? "إعدادات البوت" : "Bot settings"}</h1>
      <Banner ar={ar} ok={searchParams.ok} error={searchParams.error} />
      <form action={saveSettings} className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold text-gold-100">{ar ? "الرسائل" : "Messages"}</h2>
          {box("enabled", "البوت شغال (يرد تلقائيًا على الرسائل)", "Bot on (answers messages automatically)")}
          {box("ask_phone", "في ماسنجر وإنستجرام: يطلب رقم الموبايل قبل تسجيل الحجز", "Messenger / Instagram: ask for a mobile number before a booking request")}
          {box("ai_enabled", "فهم الكلام الحر بالذكاء الاصطناعي (Claude) — بيختار من ردودكم المعتمدة فقط", "Understand free text with AI (Claude) — it only picks from your approved answers")}
          <label className="block"><span className="label">{ar ? "رسالة الترحيب" : "Greeting (Arabic)"}</span><input name="greeting_ar" defaultValue={s?.greeting_ar} className="input" /></label>
          <label className="block"><span className="label">Greeting (English)</span><input name="greeting_en" defaultValue={s?.greeting_en} className="input" dir="ltr" /></label>
          <label className="block"><span className="label">{ar ? "رسالة التحويل لموظف" : "Handoff message (Arabic)"}</span><input name="handoff_ar" defaultValue={s?.handoff_ar} className="input" /></label>
          <label className="block"><span className="label">Handoff (English)</span><input name="handoff_en" defaultValue={s?.handoff_en} className="input" dir="ltr" /></label>
        </section>
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold text-gold-100">{ar ? "الكومنتات" : "Comments"}</h2>
          {box("comment_private_reply", "يبعت رسالة خاصة بقائمة الخدمات لكل استفسار", "Send a private message with the service menu to every inquiry")}
          {box("comment_public_reply", "يرد علنًا تحت الكومنت (ردود متنوعة)", "Reply publicly under the comment (varied replies)")}
          {box("comment_thank_positive", "يشكر على الكومنتات الإيجابية", "Thank positive comments")}
          {box("comment_hide_spam", "يخفي السبام والكومنتات المسيئة تلقائيًا", "Hide spam and abusive comments automatically")}
          {box("comment_escalate", "الشكاوى: اعتذار علني + رسالة خاصة + تحويل لموظف", "Complaints: public apology + private message + hand to a person")}
          <label className="block"><span className="label">{ar ? "الردود العلنية (كل سطر رد)" : "Public replies (one per line)"}</span>
            <textarea name="comment_replies_ar" rows={3} defaultValue={(s?.comment_replies_ar ?? []).join("\n")} className="input" /></label>
          <label className="block"><span className="label">{ar ? "الرسالة الخاصة ({name} = الاسم)" : "Private message ({name} = name)"}</span>
            <input name="private_message_ar" defaultValue={s?.private_message_ar} className="input" /></label>
        </section>
        <section className="card space-y-3 p-4 lg:col-span-2">
          <h2 className="font-semibold text-gold-100">{ar ? "طريقة الحجز" : "Booking flow"}</h2>
          <select name="booking_flow" defaultValue={s?.booking_flow ?? "slots"} className="input">
            <option value="slots">{ar ? "البوت يسجّل طلب الحجز: اليوم + الوقت، والفريق يأكد" : "The bot takes a booking request: day + time; the team confirms"}</option>
            <option value="intake">{ar ? "أسئلة الحجز: سؤال الفلترة ← أول كشف ولا متابعة ← الوقت ← الاسم ← تحويل لخدمة العملاء" : "Intake: filter question → first visit or follow-up → time → name → customer service"}</option>
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">{ar ? "سؤال أول كشف ولا متابعة (فاضي = مايتسألش)" : "First visit or follow-up question (empty = not asked)"}</span><input name="intake_visit_ar" defaultValue={s?.intake_visit_ar ?? ""} placeholder="ده أول كشف ليك عندنا ولا متابعة؟" className="input" /></label>
            <label className="block"><span className="label">Visit question (EN)</span><input name="intake_visit_en" defaultValue={s?.intake_visit_en ?? ""} className="input" dir="ltr" /></label>
            <label className="block"><span className="label">{ar ? "رسالة آخر الأسئلة ({name} = الاسم)" : "After the last question ({name} = name)"}</span><textarea name="intake_done_ar" rows={2} defaultValue={s?.intake_done_ar ?? ""} className="input" /></label>
            <label className="block"><span className="label">After the last question (EN)</span><textarea name="intake_done_en" rows={2} defaultValue={s?.intake_done_en ?? ""} className="input" dir="ltr" /></label>
            <label className="block"><span className="label">{ar ? "رد الطوارئ" : "Emergency reply"}</span><textarea name="emergency_ar" rows={2} defaultValue={s?.emergency_ar ?? ""} className="input" /></label>
            <label className="block"><span className="label">Emergency (EN)</span><textarea name="emergency_en" rows={2} defaultValue={s?.emergency_en ?? ""} className="input" dir="ltr" /></label>
            <label className="block"><span className="label">{ar ? "رد السؤال الطبي (دوا، جرعة، تشخيص)" : "Medical question reply (medicine, dose, diagnosis)"}</span><textarea name="medical_ar" rows={2} defaultValue={s?.medical_ar ?? ""} className="input" /></label>
            <label className="block"><span className="label">Medical reply (EN)</span><textarea name="medical_en" rows={2} defaultValue={s?.medical_en ?? ""} className="input" dir="ltr" /></label>
          </div>
          <p className="muted text-xs">{ar ? "الخانات الفاضية بتستخدم الرد الافتراضي." : "Empty fields use the default reply."}</p>
        </section>
        <section className="card space-y-3 p-4 lg:col-span-2">
          <h2 className="font-semibold text-gold-100">{ar ? "الربط بنظام العميل (مثل Golden Care OS)" : "Client system integration (e.g. Golden Care OS)"}</h2>
          <p className="muted text-xs">{ar ? "كل عميل جديد، وطلب حجز، وتحويل لموظف يتبعت لنظامكم موقّعًا (X-Engage-Signature) مع إعادة المحاولة تلقائيًا." : "Every new lead, booking request and handoff is sent to your system, signed (X-Engage-Signature), with automatic retries."}</p>
          <label className="block"><span className="label">{ar ? "رابط الاستقبال" : "Receiving URL"}</span><input name="integration_url" defaultValue={s?.integration_url ?? ""} placeholder="https://…/api/integrations/engage" className="input num" /></label>
          <p className="text-xs">{ar ? "رابط Webhook الخاص بـMeta (يتسجل مرة واحدة في تطبيق Meta): " : "Meta webhook URL (registered once in the Meta app): "}<code className="num rounded bg-coal-900 px-2 py-1 text-gold-100">{origin}/api/webhooks/meta</code></p>
        </section>
        <Submit className="btn-gold lg:col-span-2">{ar ? "حفظ الإعدادات" : "Save settings"}</Submit>
      </form>
      {ctx.role === "owner" && (
        <section className="card mt-4 space-y-2 p-4 text-sm">
          <p className="font-semibold">{ar ? "مفتاح التوقيع (يتحط في نظام العميل)" : "Signing secret (goes in the client's system)"}</p>
          {secret ? <code className="num block break-all rounded bg-coal-900 px-2 py-2 text-gold-100" data-secret>{secret}</code>
            : <a href="/app/settings?show=1" className="text-gold-300 underline">{ar ? "عرض المفتاح" : "Show secret"}</a>}
          <form action={rotateSecret}><Submit className="btn-ghost" confirm={ar ? "تغيير المفتاح؟ لازم تحدّثه في نظام العميل." : "Rotate? Update it in the client system too."}>{ar ? "تغيير المفتاح" : "Rotate secret"}</Submit></form>
        </section>
      )}
    </>
  );
}
