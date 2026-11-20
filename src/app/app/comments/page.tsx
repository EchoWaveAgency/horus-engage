import Link from "next/link";
import { requireOrg } from "@/lib/session";
import { AutoRefresh, Submit } from "@/components/ui";
import { Banner, CLASS, when } from "@/components/bits";
import { commentAction } from "@/app/actions/inbox";

export const metadata = { title: "Comments" };
export const dynamic = "force-dynamic";
type C = { id: string; platform: string; author_name: string | null; body: string; classification: string | null; status: string; public_reply: string | null;
  private_reply_at: string | null; hidden_at: string | null; conversation_id: string | null; received_at: string; actions: { at: string; what: string }[] };

export default async function Comments({ searchParams }: { searchParams: { v?: string; ok?: string; error?: string } }) {
  const ctx = await requireOrg();
  const ar = ctx.ar;
  const v = ["needs_human", "auto_handled", "hidden", "all"].includes(searchParams.v ?? "") ? searchParams.v! : "needs_human";
  let q = ctx.supabase.from("comments").select("id, platform, author_name, body, classification, status, public_reply, private_reply_at, hidden_at, conversation_id, received_at, actions")
    .eq("org_id", ctx.org.id).order("received_at", { ascending: false }).limit(200);
  if (v === "needs_human") q = q.eq("status", "needs_human");
  if (v === "auto_handled") q = q.eq("status", "auto_handled");
  if (v === "hidden") q = q.not("hidden_at", "is", null);
  const { data } = await q.returns<C[]>();
  const canAct = ctx.role !== "viewer";
  const tabs: [string, string, string][] = [["needs_human", "محتاج رد موظف", "Needs a person"], ["auto_handled", "ردّ عليها البوت", "Handled by the bot"], ["hidden", "مخفية", "Hidden"], ["all", "الكل", "All"]];
  return (
    <>
      <AutoRefresh seconds={15} />
      <h1 className="mb-1 text-xl font-semibold">{ar ? "الكومنتات" : "Comments"}</h1>
      <p className="muted mb-4 text-sm">{ar ? "البوت يرد على الاستفسارات علنًا ويبعت رسالة خاصة، يخفي السبام والإساءة، ويحوّل الشكاوى لكم." : "The bot replies publicly and in private to inquiries, hides spam and abuse, and sends complaints to you."}</p>
      <Banner ar={ar} ok={searchParams.ok} error={searchParams.error} />
      <nav className="mb-4 flex gap-2 overflow-x-auto">
        {tabs.map(([k, a, e]) => <Link key={k} href={`/app/comments?v=${k}`} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm ${v === k ? "bg-gold-300 text-coal-950" : "bg-coal-800 text-ivory-200"}`}>{ar ? a : e}</Link>)}
      </nav>
      <ul className="grid gap-3 lg:grid-cols-2" data-comments>
        {(data ?? []).map((c) => (
          <li key={c.id} className={`card min-w-0 p-4 ${c.status === "needs_human" ? "border-orange-400/60" : ""}`} data-comment={c.id}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>{c.platform === "instagram" ? "🟣 Instagram" : "🔵 Facebook"}</span>
              {c.classification && <span className={`chip ${CLASS[c.classification].tone}`}>{ar ? CLASS[c.classification].ar : CLASS[c.classification].en}</span>}
              {c.hidden_at && <span className="chip bg-coal-600">{ar ? "مخفي" : "Hidden"}</span>}
              <span className="muted ms-auto">{when(c.received_at, ctx.lang, ctx.org.timezone)}</span>
            </div>
            <p className="mt-2 font-semibold">{c.author_name ?? "—"}</p>
            <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-coal-900 px-3 py-2 text-sm">{c.body || "—"}</p>
            {(c.public_reply || c.private_reply_at) && (
              <p className="mt-2 text-xs text-emerald-200">{c.public_reply && <>↩ {c.public_reply}</>} {c.private_reply_at && <>· ✉ {ar ? "رسالة خاصة" : "private message"}</>}
                {c.conversation_id && <> · <Link href={`/app/c/${c.conversation_id}`} className="underline">{ar ? "المحادثة" : "conversation"}</Link></>}</p>
            )}
            <p className="muted mt-1 break-words text-[11px]">{c.actions.map((a) => a.what).join(" · ")}</p>
            {canAct && (
              <div className="mt-3 space-y-2">
                <form action={commentAction} className="flex min-w-0 gap-2"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="action" value="reply" />
                  <input name="text" className="input" placeholder={ar ? "رد علني…" : "Public reply…"} maxLength={1000} /><Submit className="btn-ghost">{ar ? "رد" : "Reply"}</Submit></form>
                <div className="flex flex-wrap gap-2">
                  {[c.hidden_at ? ["unhide", "إظهار", "Unhide"] : ["hide", "إخفاء", "Hide"], ["done", "تم", "Done"], ["ignore", "تجاهل", "Ignore"]].map(([act, a, e]) => (
                    <form key={act} action={commentAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="action" value={act} />
                      <Submit className="btn-ghost min-h-0 px-3 py-1.5 text-xs">{ar ? a : e}</Submit></form>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
        {(data ?? []).length === 0 && <li className="card p-10 text-center text-ivory-300/70 lg:col-span-2">{ar ? "لا شيء هنا." : "Nothing here."}</li>}
      </ul>
    </>
  );
}
