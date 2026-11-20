"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

export async function signIn(form: FormData) {
  const supabase = supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
  if (error) redirect("/login?error=1");
  redirect("/app");
}
export async function signOut() {
  await supabaseServer().auth.signOut();
  redirect("/login");
}
export async function setLang(form: FormData) {
  cookies().set("eg_lang", form.get("lang") === "en" ? "en" : "ar", { path: "/", maxAge: 31536000, sameSite: "lax" });
  const back = String(form.get("back") ?? "/app");
  redirect(back.startsWith("/app") ? back : "/app");
}
export async function setOrg(form: FormData) {
  cookies().set("eg_org", String(form.get("org") ?? ""), { path: "/", maxAge: 31536000, sameSite: "lax", httpOnly: true });
  redirect("/app");
}
