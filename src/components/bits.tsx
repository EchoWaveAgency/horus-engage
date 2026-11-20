export const CHANNEL: Record<string, { ar: string; en: string; icon: string }> = {
  whatsapp: { ar: "واتساب", en: "WhatsApp", icon: "🟢" }, messenger: { ar: "ماسنجر", en: "Messenger", icon: "🔵" }, instagram: { ar: "إنستجرام", en: "Instagram", icon: "🟣" },
};
export const REASON: Record<string, { ar: string; en: string }> = {
  asked_human: { ar: "طلب موظف", en: "Asked for a person" }, medical_question: { ar: "سؤال طبي", en: "Medical question" },
  complaint: { ar: "شكوى", en: "Complaint" }, not_understood: { ar: "البوت مفهمش", en: "Bot did not understand" },
  price_unknown: { ar: "سعر غير معتمد", en: "No approved price" }, booking_human: { ar: "حجز مع موظف", en: "Booking with a person" }, media: { ar: "صوت / صورة", en: "Voice / image" },
};
export const CLASS: Record<string, { ar: string; en: string; tone: string }> = {
  inquiry: { ar: "استفسار", en: "Inquiry", tone: "bg-sky-500/15 text-sky-200" }, price: { ar: "سعر", en: "Price", tone: "bg-gold-300/20 text-gold-100" },
  positive: { ar: "إيجابي", en: "Positive", tone: "bg-emerald-500/15 text-emerald-200" }, complaint: { ar: "شكوى", en: "Complaint", tone: "bg-red-500/20 text-red-200" },
  spam: { ar: "سبام", en: "Spam", tone: "bg-coal-600 text-ivory-300" }, abuse: { ar: "مسيء", en: "Abusive", tone: "bg-coal-600 text-ivory-300" },
  other: { ar: "أخرى", en: "Other", tone: "bg-coal-600 text-ivory-300" },
};
export function Banner({ error, ok, ar }: { error?: string; ok?: string; ar: boolean }) {
  if (error) return <p role="alert" className="mb-4 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>;
  if (ok) return <p role="status" className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{ar ? "تم." : "Done."}</p>;
  return null;
}
export function Kpi({ label, value, tone = "text-gold-300" }: { label: string; value: string | number; tone?: string }) {
  return <div className="card p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-ivory-300/70">{label}</p><p className={`num mt-2 text-2xl font-semibold ${tone}`}>{value}</p></div>;
}
export function when(iso: string | null | undefined, lang: "ar" | "en", tz = "Africa/Cairo") {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
export function ago(iso: string | null | undefined, ar: boolean) {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return ar ? "الآن" : "now";
  if (s < 3600) return ar ? `${Math.floor(s / 60)} د` : `${Math.floor(s / 60)} min`;
  if (s < 86400) return ar ? `${Math.floor(s / 3600)} س` : `${Math.floor(s / 3600)} h`;
  return ar ? `${Math.floor(s / 86400)} يوم` : `${Math.floor(s / 86400)} d`;
}
