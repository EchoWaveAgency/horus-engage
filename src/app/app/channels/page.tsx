import { requireOrg } from "@/lib/session";
import { Submit } from "@/components/ui";
import { Banner, CHANNEL } from "@/components/bits";
import { addChannel, updateChannel } from "@/app/actions/inbox";

export const metadata = { title: "Channels" };
export const dynamic = "force-dynamic";
type Ch = { id: string; kind: string; external_id: string; name: string; auto_reply: boolean; comments: boolean; is_active: boolean };

export default async function Channels({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const ctx = await requireOrg();
  const ar = ctx.ar;
  const admin = Boolean(ctx.profile?.is_platform_admin);
  const { data } = await ctx.supabase.from("channels").select("*").eq("org_id", ctx.org.id).order("kind").returns<Ch[]>();
  const tokens = await Promise.all((data ?? []).map((c) => ctx.supabase.rpc("channel_has_token", { p_channel: c.id })));
  const env = (k: string) => Boolean(process.env[k]);
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">{ar ? "القنوات" : "Channels"}</h1>
      <Banner ar={ar} ok={searchParams.ok} error={searchParams.error} />
      <section className="card mb-4 grid gap-1 p-4 text-sm md:grid-cols-3">
        {[["META_APP_SECRET", "توقيع Meta"], ["META_VERIFY_TOKEN", "تحقق الـWebhook"], ["SUPABASE_SERVICE_ROLE_KEY", "حفظ الرسائل"], ["CRON_SECRET", "إرسال الأحداث لنظام العميل"], ["ANTHROPIC_API_KEY", "الذكاء الاصطناعي (اختياري)"]].map(([k, a]) => (
          <p key={k}><span className={env(k) ? "text-emerald-300" : "text-red-300"}>{env(k) ? "✓" : "✗"}</span> <code className="num text-xs">{k}</code> <span className="muted text-xs">— {a}</span></p>
        ))}
      </section>
      <ul className="space-y-3">
        {(data ?? []).map((c, i) => (
          <li key={c.id} className="card p-4">
            <form action={updateChannel} className="flex flex-wrap items-center gap-4 text-sm">
              <input type="hidden" name="id" value={c.id} />
              <span className="text-lg">{CHANNEL[c.kind].icon}</span>
              <span className="font-semibold">{c.name}</span>
              <span className="muted num text-xs">{ar ? CHANNEL[c.kind].ar : CHANNEL[c.kind].en} · {c.external_id}</span>
              <span className={tokens[i].data ? "text-emerald-300" : "text-red-300"}>{tokens[i].data ? (ar ? "✓ التوكن محفوظ" : "✓ token stored") : (ar ? "✗ لا يوجد توكن" : "✗ no token")}</span>
              <label className="flex items-center gap-1"><input type="checkbox" name="auto_reply" defaultChecked={c.auto_reply} />{ar ? "رد تلقائي" : "Auto reply"}</label>
              {c.kind !== "whatsapp" && <label className="flex items-center gap-1"><input type="checkbox" name="comments" defaultChecked={c.comments} />{ar ? "الكومنتات" : "Comments"}</label>}
              <label className="flex items-center gap-1"><input type="checkbox" name="is_active" defaultChecked={c.is_active} />{ar ? "نشطة" : "Active"}</label>
              {admin && <input name="token" type="password" placeholder={ar ? "توكن جديد (اختياري)" : "New token (optional)"} className="input w-56" autoComplete="off" />}
              <Submit className="btn-ghost">{ar ? "حفظ" : "Save"}</Submit>
            </form>
          </li>
        ))}
      </ul>
      {admin && (
        <form action={addChannel} className="card mt-4 grid gap-3 p-4 sm:grid-cols-4">
          <p className="font-semibold text-gold-100 sm:col-span-4">{ar ? "ربط قناة جديدة (مدير المنصة)" : "Connect a channel (platform admin)"}</p>
          <select name="kind" className="input"><option value="whatsapp">WhatsApp — phone_number_id</option><option value="messenger">Facebook page — page id</option><option value="instagram">Instagram — account id</option></select>
          <input name="external_id" required placeholder="ID" className="input num" />
          <input name="name" required placeholder={ar ? "الاسم" : "Name"} className="input" />
          <input name="token" type="password" placeholder={ar ? "توكن System User / Page" : "System user / page token"} className="input" autoComplete="off" />
          <Submit className="btn-gold sm:col-span-4">{ar ? "ربط" : "Connect"}</Submit>
        </form>
      )}
    </>
  );
}
