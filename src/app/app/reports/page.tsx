import Link from "next/link";
import { requireOrg } from "@/lib/session";
import { CHANNEL, CLASS, Kpi, REASON } from "@/components/bits";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";
type R = { conversations: number; by_channel: Record<string, number>; bookings: number; booked_by_bot: number; handoffs: number; handoff_reasons: Record<string, number>;
  waiting_now: number; avg_human_reply_seconds: number | null; by_service: Record<string, number>; comments: number; comments_by_class: Record<string, number>;
  comments_auto: number; comments_need_human: number; comments_hidden: number; comment_dms: number };

export default async function Reports({ searchParams }: { searchParams: { d?: string } }) {
  const ctx = await requireOrg();
  const ar = ctx.ar;
  const days = [1, 7, 30].includes(Number(searchParams.d)) ? Number(searchParams.d) : 7;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: ctx.org.timezone });
  const from = new Date(Date.now() - (days - 1) * 86400_000).toLocaleDateString("en-CA", { timeZone: ctx.org.timezone });
  const { data } = await ctx.supabase.rpc("org_report", { p_org: ctx.org.id, p_from: from, p_to: today });
  const r = (data ?? {}) as R;
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
  const mins = (s: number | null) => (s == null ? "—" : s < 60 ? `${Math.round(s)} ${ar ? "ث" : "s"}` : `${Math.round(s / 60)} ${ar ? "د" : "min"}`);
  const table = (title: string, rows: [string, number][]) => (
    <section className="card p-4"><h2 className="mb-2 text-sm font-semibold text-gold-100">{title}</h2>
      {rows.length ? <ul className="space-y-1 text-sm">{rows.sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k} className="flex justify-between"><span>{k}</span><span className="num">{n}</span></li>)}</ul> : <p className="muted text-sm">—</p>}</section>
  );
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="me-auto text-xl font-semibold">{ar ? "التقارير" : "Reports"}</h1>
        {[1, 7, 30].map((d) => <Link key={d} href={`/app/reports?d=${d}`} className={`rounded-lg px-3 py-1.5 text-sm ${d === days ? "bg-gold-300 text-coal-950" : "bg-coal-800"}`}>{d === 1 ? (ar ? "اليوم" : "Today") : ar ? `${d} يوم` : `${d} days`}</Link>)}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-report>
        <Kpi label={ar ? "محادثات" : "Conversations"} value={r.conversations ?? 0} tone="text-ivory-50" />
        <Kpi label={ar ? "طلبات حجز" : "Booking requests"} value={r.bookings ?? 0} tone="text-emerald-300" />
        <Kpi label={ar ? "حجز كامل بالبوت" : "Booked fully by the bot"} value={pct(r.booked_by_bot ?? 0, r.bookings ?? 0)} />
        <Kpi label={ar ? "اتحولت لموظف" : "Handed to a person"} value={`${r.handoffs ?? 0} (${pct(r.handoffs ?? 0, r.conversations ?? 0)})`} tone="text-orange-300" />
        <Kpi label={ar ? "متوسط رد الموظف بعد التحويل" : "Avg staff reply after handoff"} value={mins(r.avg_human_reply_seconds)} />
        <Kpi label={ar ? "مستنيين موظف الآن" : "Waiting for a person now"} value={r.waiting_now ?? 0} tone={(r.waiting_now ?? 0) ? "text-red-300" : "text-ivory-50"} />
        <Kpi label={ar ? "كومنتات" : "Comments"} value={r.comments ?? 0} tone="text-ivory-50" />
        <Kpi label={ar ? "كومنتات ردّ عليها البوت" : "Comments handled by the bot"} value={pct(r.comments_auto ?? 0, r.comments ?? 0)} />
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {table(ar ? "حسب القناة" : "By channel", Object.entries(r.by_channel ?? {}).map(([k, n]) => [ar ? CHANNEL[k]?.ar ?? k : CHANNEL[k]?.en ?? k, n]))}
        {table(ar ? "حسب الخدمة" : "By service", Object.entries(r.by_service ?? {}))}
        {table(ar ? "أسباب التحويل لموظف" : "Handoff reasons", Object.entries(r.handoff_reasons ?? {}).map(([k, n]) => [ar ? REASON[k]?.ar ?? k : REASON[k]?.en ?? k, n]))}
        {table(ar ? "أنواع الكومنتات" : "Comment types", Object.entries(r.comments_by_class ?? {}).map(([k, n]) => [ar ? CLASS[k]?.ar ?? k : CLASS[k]?.en ?? k, n]))}
      </div>
      <p className="muted mt-4 text-xs">{ar ? `رسائل خاصة من الكومنتات: ${r.comment_dms ?? 0} · مخفية: ${r.comments_hidden ?? 0} · مستنية موظف: ${r.comments_need_human ?? 0}` : `Private replies from comments: ${r.comment_dms ?? 0} · hidden: ${r.comments_hidden ?? 0} · waiting for a person: ${r.comments_need_human ?? 0}`}</p>
    </>
  );
}
