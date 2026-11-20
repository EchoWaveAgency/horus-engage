import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export type Role = "owner" | "admin" | "agent" | "viewer";
export type Membership = { org_id: string; role: Role; on_duty: boolean; org: { id: string; name: string; slug: string; timezone: string } };

const load = cache(async () => {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: profile }, { data: members }] = await Promise.all([
    supabase.from("profiles").select("full_name, locale, is_platform_admin").eq("user_id", user.id).maybeSingle(),
    supabase.from("org_members").select("org_id, role, on_duty, org:orgs(id, name, slug, timezone)").eq("user_id", user.id).eq("is_active", true),
  ]);
  let list = ((members ?? []) as unknown as Membership[]).filter((m) => m.org);
  if (profile?.is_platform_admin) {
    const { data: orgs } = await supabase.from("orgs").select("id, name, slug, timezone").order("name");
    const own = new Set(list.map((m) => m.org_id));
    list = [...list, ...((orgs ?? []).filter((o) => !own.has(o.id)).map((o) => ({ org_id: o.id, role: "owner" as Role, on_duty: false, org: o })))];
  }
  const wanted = cookies().get("eg_org")?.value;
  const current = list.find((m) => m.org_id === wanted) ?? list[0] ?? null;
  const lang = cookies().get("eg_lang")?.value === "en" ? "en" : (profile?.locale === "en" && !cookies().get("eg_lang") ? "en" : "ar");
  return { supabase, user, profile, memberships: list, current, lang: lang as "ar" | "en", ar: lang !== "en" };
});

export async function getContext() { return load(); }
export async function requireOrg(roles?: Role[]) {
  const ctx = await load();
  if (!ctx.current) redirect("/app/no-access");
  if (roles && !roles.includes(ctx.current.role)) redirect("/app?denied=1");
  return { ...ctx, org: ctx.current!.org, role: ctx.current!.role };
}
