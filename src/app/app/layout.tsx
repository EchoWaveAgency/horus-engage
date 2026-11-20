import Link from "next/link";
import { getContext } from "@/lib/session";
import { setLang, setOrg, signOut } from "@/app/actions/auth";
import { toggleDuty } from "@/app/actions/inbox";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const ar = ctx.ar;
  const role = ctx.current?.role;
  const nav: [string, string, string, boolean][] = [
    ["/app", "صندوق الرسائل", "Inbox", true],
    ["/app/comments", "الكومنتات", "Comments", true],
    ["/app/reports", "التقارير", "Reports", true],
    ["/app/services", "الخدمات والردود", "Services & answers", role === "owner" || role === "admin"],
    ["/app/settings", "الإعدادات", "Settings", role === "owner" || role === "admin"],
    ["/app/channels", "القنوات", "Channels", role === "owner" || role === "admin" || Boolean(ctx.profile?.is_platform_admin)],
  ];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-coal-600 bg-coal-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/app" className="me-2">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.25em] text-gold-300">HORUS</span>
            <span className="font-semibold">Engage</span>
          </Link>
          {ctx.memberships.length > 1 ? (
            <form action={setOrg} className="flex items-center gap-1">
              <select name="org" defaultValue={ctx.current?.org_id} className="input w-auto py-1.5 text-xs" aria-label={ar ? "العميل" : "Client"}>
                {ctx.memberships.map((m) => <option key={m.org_id} value={m.org_id}>{m.org.name}</option>)}
              </select>
              <button className="btn-ghost min-h-0 px-2 py-1.5 text-xs">{ar ? "تبديل" : "Switch"}</button>
            </form>
          ) : <span className="text-sm text-gold-100">{ctx.current?.org.name}</span>}
          <nav className="order-last flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
            {nav.filter((n) => n[3]).map(([href, a, e]) => <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-ivory-200 hover:bg-coal-800 hover:text-gold-100">{ar ? a : e}</Link>)}
          </nav>
          <div className="ms-auto flex items-center gap-3 text-xs">
            {ctx.current && role !== "viewer" && (
              <form action={toggleDuty}><input type="hidden" name="on" value={ctx.current.on_duty ? "0" : "1"} />
                <button className={`rounded-full px-3 py-1.5 font-semibold ${ctx.current.on_duty ? "bg-emerald-500 text-coal-950" : "border border-coal-500 text-ivory-300"}`}>
                  {ctx.current.on_duty ? (ar ? "● متاح" : "● Available") : (ar ? "○ غير متاح" : "○ Away")}</button></form>
            )}
            <span className="muted hidden sm:inline">{ctx.profile?.full_name}</span>
            <form action={setLang}><input type="hidden" name="lang" value={ar ? "en" : "ar"} /><button className="text-gold-300">{ar ? "English" : "العربية"}</button></form>
            <form action={signOut}><button className="muted hover:text-ivory-100">{ar ? "خروج" : "Sign out"}</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
