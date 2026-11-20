import Link from "next/link";
import { requireOrg } from "@/lib/session";
import { AutoRefresh } from "@/components/ui";
import { ago, Banner, CHANNEL, Kpi, REASON } from "@/components/bits";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

type Row = { id: string; status: string; needs_attention: boolean; handoff_reason: string | null; last_inbound_at: string | null; source: string | null;
  campaign_code: string | null; booked_at: string | null; assigned_to: string | null;
  contact: { name: string | null; phone: string | null } | null; channel: { kind: string; name: string } | null; service: { code: string; name_ar: string; name_en: string } | null };

export default async function Inbox({ searchParams }: { searchParams: { v?: string; ok?: string; error?: string } }) {
  const ctx = await requireOrg();
  const ar = ctx.ar;
  const v = ["waiting", "bot", "mine", "human", "closed"].includes(searchParams.v ?? "") ? searchParams.v! : "waiting";
  let q = ctx.supabase.from("conversations")
    .select("id, status, needs_attention, handoff_reason, last_inbound_at, source, campaign_code, booked_at, assigned_to, contact:contacts(name, phone), channel:channels(kind, name), service:services(code, name_ar, name_en)")
    .eq("org_id", ctx.org.id).order("last_inbound_at", { ascending: v === "waiting", nullsFirst: false }).limit(200);
  if (v === "waiting") q = q.eq("status", "human").eq("needs_attention", true);
  if (v === "bot") q = q.eq("status", "bot");
  if (v === "mine") q = q.eq("status", "human").eq("assigned_to", ctx.user.id);
  if (v === "human") q = q.eq("status", "human");
  if (v === "closed") q = q.eq("status", "closed");
  const [{ data }, counts] = await Promise.all([
    q.returns<Row[]>(),
    Promise.all([
      ctx.supabase.from("conversations").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id).eq("status", "human").eq("needs_attention", true),
      ctx.supabase.from("conversations").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id).eq("status", "bot"),
      ctx.supabase.from("comments").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id).eq("status", "needs_human"),
      ctx.supabase.from("bookings").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id).gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
    ]),
  ]);
  const [waiting, bot, comments, bookings] = counts.map((c) => c.count ?? 0);
  const tabs: [string, string, string][] = [["waiting", "محتاج موظف", "Needs a person"], ["bot", "مع البوت", "With the bot"], ["mine", "محادثاتي", "Mine"], ["human", "مع الموظفين", "With staff"], ["closed", "مغلقة", "Closed"]];
  return (
    <>
      <AutoRefresh seconds={10} />
      <Banner ar={ar} ok={searchParams.ok} error={searchParams.error} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={ar ? "🔴 محتاج موظف" : "🔴 Needs a person"} value={waiting} tone={waiting ? "text-red-300" : "text-ivory-50"} />
        <Kpi label={ar ? "🤖 البوت بيرد" : "🤖 Bot handling"} value={bot} />
        <Kpi label={ar ? "💬 كومنتات محتاجة رد" : "💬 Comments for a person"} value={comments} tone={comments ? "text-orange-300" : "text-ivory-50"} />
        <Kpi label={ar ? "📅 طلبات حجز (24 س)" : "📅 Booking requests (24 h)"} value={bookings} tone="text-emerald-300" />
      </div>
      <nav className="mb-4 flex gap-2 overflow-x-auto">
        {tabs.map(([k, a, e]) => <Link key={k} href={`/app?v=${k}`} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm ${v === k ? "bg-gold-300 text-coal-950" : "bg-coal-800 text-ivory-200"}`}>{ar ? a : e}</Link>)}
      </nav>
      <ul className="space-y-2" data-inbox>
        {(data ?? []).map((c) => (
          <li key={c.id}>
            <Link href={`/app/c/${c.id}`} data-conv={c.id} className={`card flex flex-wrap items-center gap-3 p-3 hover:border-gold-300 ${c.needs_attention && c.status === "human" ? "border-red-400/60" : ""}`}>
              <span className="text-lg" title={c.channel?.kind}>{CHANNEL[c.channel?.kind ?? ""]?.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.contact?.name ?? c.contact?.phone ?? (ar ? "عميل" : "Customer")}</p>
                <p className="muted text-xs">
                  {ar ? CHANNEL[c.channel?.kind ?? ""]?.ar : CHANNEL[c.channel?.kind ?? ""]?.en}
                  {c.service && <> · <span className="text-gold-100">{ar ? c.service.name_ar : c.service.name_en}</span></>}
                  {c.campaign_code && <> · <span className="num">{c.campaign_code}</span></>}
                  {c.source === "comment" && <> · {ar ? "من كومنت" : "from a comment"}</>}
                  {c.source === "ad" && <> · {ar ? "من إعلان" : "from an ad"}</>}
                </p>
              </div>
              {c.booked_at && <span className="chip bg-emerald-500/20 text-emerald-200">{ar ? "📅 طلب حجز" : "📅 Booking request"}</span>}
              {c.status === "bot" && <span className="chip bg-coal-600 text-ivory-200">🤖 {ar ? "البوت" : "Bot"}</span>}
              {c.status === "human" && c.needs_attention && <span className="chip bg-red-500/20 text-red-200">{ar ? REASON[c.handoff_reason ?? ""]?.ar ?? "ينتظر رد" : REASON[c.handoff_reason ?? ""]?.en ?? "Waiting"}</span>}
              <span className="muted text-xs">{ago(c.last_inbound_at, ar)}</span>
            </Link>
          </li>
        ))}
        {(data ?? []).length === 0 && <li className="card p-10 text-center text-ivory-300/70">{ar ? "لا توجد محادثات هنا." : "No conversations here."}</li>}
      </ul>
    </>
  );
}
