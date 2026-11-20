import Link from "next/link";
import { requireOrg } from "@/lib/session";
import { AutoRefresh, Submit } from "@/components/ui";
import { Banner, CHANNEL, REASON, when } from "@/components/bits";
import { closeConversation, handBack, reply, takeOver } from "@/app/actions/inbox";

export const metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

type Conv = { id: string; status: string; needs_attention: boolean; handoff_reason: string | null; last_inbound_at: string | null; source: string | null;
  campaign_code: string | null; referral: Record<string, string> | null; booked_at: string | null; created_at: string;
  contact: { name: string | null; phone: string | null } | null; channel: { kind: string; name: string } | null; service: { name_ar: string; name_en: string } | null };
type Msg = { id: number; direction: string; author: string; body: string; status: string; error: string | null; created_at: string };

export default async function ConversationPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireOrg();
  const ar = ctx.ar, tz = ctx.org.timezone, lang = ctx.lang;
  const { data: c } = await ctx.supabase.from("conversations")
    .select("id, status, needs_attention, handoff_reason, last_inbound_at, source, campaign_code, referral, booked_at, created_at, contact:contacts(name, phone), channel:channels(kind, name), service:services(name_ar, name_en)")
    .eq("id", params.id).maybeSingle<Conv>();
  if (!c) return <div className="card p-10 text-center">{ar ? "المحادثة غير موجودة." : "Conversation not found."}</div>;
  const [{ data: msgs }, { data: bookings }] = await Promise.all([
    ctx.supabase.from("messages").select("id, direction, author, body, status, error, created_at").eq("conversation_id", c.id).order("created_at").limit(500).returns<Msg[]>(),
    ctx.supabase.from("bookings").select("preferred_day, preferred_period, status, external_ref, created_at").eq("conversation_id", c.id).order("created_at", { ascending: false }),
  ]);
  const canAct = ctx.role !== "viewer" && c.status !== "closed";
  const windowOpen = c.last_inbound_at && Date.now() - new Date(c.last_inbound_at).getTime() < 24 * 3600_000;
  const who: Record<string, string> = { contact: ar ? "العميل" : "Customer", bot: ar ? "🤖 البوت" : "🤖 Bot", agent: ar ? "👤 موظف" : "👤 Agent", system: ar ? "النظام" : "System" };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <AutoRefresh seconds={8} />
      <section className="card flex min-h-[70vh] flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-coal-600 p-4">
          <Link href="/app" className="text-sm text-gold-300">{ar ? "→" : "←"}</Link>
          <span className="text-lg">{CHANNEL[c.channel?.kind ?? ""]?.icon}</span>
          <div className="flex-1"><h1 className="font-semibold" data-contact>{c.contact?.name ?? (ar ? "عميل" : "Customer")}</h1>
            <p className="muted num text-xs">{c.contact?.phone ?? (ar ? CHANNEL[c.channel?.kind ?? ""]?.ar : CHANNEL[c.channel?.kind ?? ""]?.en)}</p></div>
          <span data-status={c.status} className={`chip ${c.status === "bot" ? "bg-coal-600" : c.status === "human" ? "bg-gold-300/20 text-gold-100" : "bg-coal-700"}`}>
            {c.status === "bot" ? (ar ? "🤖 مع البوت" : "🤖 With the bot") : c.status === "human" ? (ar ? "👤 مع موظف" : "👤 With staff") : ar ? "مغلقة" : "Closed"}</span>
        </header>
        <Banner ar={ar} error={searchParams.error} ok={searchParams.ok} />
        <ol className="flex-1 space-y-2 overflow-y-auto p-4" data-thread>
          {(msgs ?? []).map((m) => (
            <li key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.author === "system" ? "mx-auto bg-transparent text-center text-xs text-ivory-300/60" : m.direction === "in" ? "me-auto bg-coal-700" : m.author === "bot" ? "ms-auto bg-gold-500/15" : "ms-auto bg-emerald-600/20"}`}>
              {m.author !== "system" && <p className="mb-1 text-[11px] text-ivory-300/70">{who[m.author]} · {when(m.created_at, lang, tz)}{m.direction === "out" && ` · ${m.status}`}</p>}
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              {m.error && <p className="mt-1 text-[11px] text-red-300">{m.error}</p>}
            </li>
          ))}
        </ol>
        {canAct && (
          <footer className="border-t border-coal-600 p-3">
            {windowOpen ? (
              <form action={reply} className="flex gap-2">
                <input type="hidden" name="id" value={c.id} />
                <textarea name="body" required rows={2} maxLength={4000} className="input" placeholder={ar ? "اكتب ردك… (البوت يسكت تلقائيًا)" : "Type your reply… (the bot goes quiet)"} />
                <Submit>{ar ? "إرسال" : "Send"}</Submit>
              </form>
            ) : <p className="muted text-xs">{ar ? "انتهت نافذة الـ24 ساعة في Meta — اتصل بالعميل أو استخدم رسالة معتمدة (template)." : "Meta's 24-hour window is closed — call the customer or use an approved template."}</p>}
          </footer>
        )}
      </section>
      <aside className="space-y-3">
        {c.status === "human" && c.needs_attention && (
          <div className="card border-red-400/60 p-4 text-sm"><p className="font-semibold text-red-200">{ar ? "محتاج موظف" : "Needs a person"}</p>
            <p className="muted mt-1">{ar ? REASON[c.handoff_reason ?? ""]?.ar : REASON[c.handoff_reason ?? ""]?.en}</p></div>
        )}
        <div className="card space-y-2 p-4 text-sm">
          <p><span className="muted">{ar ? "الخدمة: " : "Service: "}</span>{c.service ? (ar ? c.service.name_ar : c.service.name_en) : "—"}</p>
          <p><span className="muted">{ar ? "الحملة: " : "Campaign: "}</span><span className="num">{c.campaign_code ?? "—"}</span></p>
          <p><span className="muted">{ar ? "المصدر: " : "Source: "}</span>{c.source === "ad" ? (ar ? "إعلان" : "Ad") : c.source === "comment" ? (ar ? "كومنت" : "Comment") : ar ? "مباشر" : "Direct"}
            {c.referral?.headline && <span className="muted block text-xs">{c.referral.headline}</span>}</p>
          <p><span className="muted">{ar ? "بدأت: " : "Started: "}</span>{when(c.created_at, lang, tz)}</p>
        </div>
        {(bookings ?? []).map((b, i) => (
          <div key={i} className="card border-emerald-400/40 p-4 text-sm" data-booking>
            <p className="font-semibold text-emerald-200">📅 {ar ? "طلب حجز" : "Booking request"}</p>
            <p><span className="num">{b.preferred_day}</span> · {({ morning: ["الصبح", "Morning"], afternoon: ["الضهر", "Afternoon"], evening: ["بالليل", "Evening"] } as Record<string, string[]>)[b.preferred_period ?? ""]?.[ar ? 0 : 1] ?? b.preferred_period}</p>
            <p className="muted text-xs">{b.external_ref ? `${ar ? "في نظام العميل: " : "In client system: "}${b.external_ref}` : ar ? "في انتظار الإرسال لنظام العميل" : "Waiting to sync"}</p>
          </div>
        ))}
        {canAct && (
          <div className="card space-y-2 p-4">
            {c.status === "bot" ? (
              <form action={takeOver}><input type="hidden" name="id" value={c.id} /><Submit className="btn-gold w-full">{ar ? "استلام المحادثة من البوت" : "Take over from the bot"}</Submit></form>
            ) : (
              <form action={handBack}><input type="hidden" name="id" value={c.id} /><Submit className="btn-ghost w-full">{ar ? "إرجاعها للبوت" : "Hand back to the bot"}</Submit></form>
            )}
            <form action={closeConversation} className="flex gap-2"><input type="hidden" name="id" value={c.id} />
              <input name="reason" required minLength={2} className="input" placeholder={ar ? "سبب الإغلاق" : "Close reason"} />
              <Submit className="btn-ghost">{ar ? "إغلاق" : "Close"}</Submit></form>
          </div>
        )}
      </aside>
    </div>
  );
}
