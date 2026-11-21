"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, requireOrg } from "@/lib/session";
import { commentOnMeta, sendAgentReply } from "@/lib/runner";

// Staff actions run under the signed-in session; the database checks membership inside every RPC.
// Sending to Meta happens only after the user's own session logged the action (and so passed the check).

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const list = (v: string) => Array.from(new Set(v.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean)));
function go(path: string, q: Record<string, string> = {}): never {
  const qs = new URLSearchParams(q).toString();
  redirect(qs ? `${path}?${qs}` : path);
}
function msg(e: { message?: string } | null, ar: boolean): string {
  const m = e?.message ?? "";
  const rules: [RegExp, string, string][] = [
    [/24-hour window/, "انتهت نافذة الـ24 ساعة في Meta — لا يمكن إرسال رسالة حرة الآن.", "Meta's 24-hour window is closed — free-text messages can't be sent now."],
    [/write the message/, "اكتب الرسالة.", "Write the message."],
    [/reason is required/, "اكتب السبب.", "Write the reason."],
    [/https:\/\//, "رابط الربط لازم يبدأ بـ https://", "The integration URL must start with https://"],
    [/duplicate key|services_org_id_code_key/, "الكود مستخدم بالفعل.", "That code already exists."],
    [/services_code_check/, "الكود بالإنجليزي والأرقام والشرطة (مثل LASER).", "Use letters, digits and dashes (e.g. LASER)."],
    [/permission denied|row-level security|42501/, "ليست لديك صلاحية.", "You don't have permission."],
    [/token looks invalid/, "التوكن غير صحيح.", "The token looks invalid."],
    [/placeholder/, "فيه خانة بين [ ] لسه ما اتملتش — املاها بالمعلومة المعتمدة، أو خلّيها متوقفة.", "A [placeholder] is still unfilled — fill it with the approved information, or keep it switched off."],
    [/invalid booking flow/, "طريقة الحجز غير صحيحة.", "Invalid booking flow."],
  ];
  const r = rules.find(([re]) => re.test(m));
  return r ? (ar ? r[1] : r[2]) : ar ? "حدث خطأ، لم يُحفظ شيء." : "Something went wrong; nothing was saved.";
}

export async function toggleDuty(form: FormData) {
  const ctx = await requireOrg();
  await ctx.supabase.rpc("set_duty", { p_org: ctx.org.id, p_on: s(form, "on") === "1" });
  revalidatePath("/app", "layout");
  go("/app");
}

export async function takeOver(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "id");
  const { error } = await ctx.supabase.rpc("conv_take_over", { p_conv: id });
  if (error) go(`/app/c/${id}`, { error: msg(error, ctx.ar) });
  revalidatePath(`/app/c/${id}`); go(`/app/c/${id}`);
}
export async function handBack(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "id");
  const { error } = await ctx.supabase.rpc("conv_release", { p_conv: id });
  if (error) go(`/app/c/${id}`, { error: msg(error, ctx.ar) });
  revalidatePath(`/app/c/${id}`); go(`/app/c/${id}`, { ok: "1" });
}
export async function closeConversation(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "id");
  const { error } = await ctx.supabase.rpc("conv_close", { p_conv: id, p_reason: s(form, "reason") });
  if (error) go(`/app/c/${id}`, { error: msg(error, ctx.ar) });
  revalidatePath("/app"); go("/app", { ok: "1" });
}
export async function reply(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "id"), body = s(form, "body");
  const { data, error } = await ctx.supabase.rpc("conv_log_reply", { p_conv: id, p_body: body });
  if (error) go(`/app/c/${id}`, { error: msg(error, ctx.ar) });
  const r = await sendAgentReply((data as { message_id: number }).message_id, id, body);
  revalidatePath(`/app/c/${id}`);
  if (!r.ok) go(`/app/c/${id}`, { error: (ctx.ar ? "لم تُرسل: " : "Not sent: ") + (r.error ?? "") });
  go(`/app/c/${id}`);
}

export async function commentAction(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "id"), action = s(form, "action");
  // Membership first: the comment must be visible to this user (RLS) before anything is done on Meta.
  const { data: cm } = await ctx.supabase.from("comments").select("id").eq("id", id).maybeSingle();
  if (!cm) go("/app/comments", { error: msg({ message: "permission denied" }, ctx.ar) });
  if (action === "hide" || action === "unhide" || action === "reply") {
    if (action === "reply" && !s(form, "text")) go("/app/comments", { error: msg({ message: "write the message" }, ctx.ar) });
    const r = await commentOnMeta(id, action, s(form, "text"));
    if (!r.ok) go("/app/comments", { error: (ctx.ar ? "رفضت Meta الطلب: " : "Meta refused: ") + (r.error ?? "") });
  }
  const mark = { hide: "hidden", unhide: "unhidden", reply: "replied", done: "done", ignore: "ignored" }[action] ?? "done";
  const { error } = await ctx.supabase.rpc("comment_mark", { p_comment: id, p_action: mark });
  if (error) go("/app/comments", { error: msg(error, ctx.ar) });
  revalidatePath("/app/comments"); go("/app/comments", { ok: "1" });
}

export async function saveService(form: FormData) {
  const ctx = await requireOrg(["owner", "admin"]);
  const id = s(form, "id");
  const row = {
    org_id: ctx.org.id, code: s(form, "code").toUpperCase().replace(/[\s_]+/g, "-"), name_ar: s(form, "name_ar"), name_en: s(form, "name_en"),
    summary_ar: s(form, "summary_ar"), summary_en: s(form, "summary_en") || s(form, "summary_ar"),
    offer_ar: s(form, "offer_ar") || null, offer_en: s(form, "offer_en") || null, price_ar: s(form, "price_ar") || null, price_en: s(form, "price_en") || null,
    duration_ar: s(form, "duration_ar") || null, duration_en: s(form, "duration_en") || null,
    booking_mode: s(form, "booking_mode") === "human_only" ? "human_only" : "request",
    keywords: list(s(form, "keywords")), campaign_codes: list(s(form, "campaign_codes")), sort: Number(s(form, "sort")) || 100, is_active: form.get("is_active") === "on",
    filter_question_ar: s(form, "filter_question_ar") || null, filter_question_en: s(form, "filter_question_en") || null,
    // one option per line: "عربي | English"
    filter_options: s(form, "filter_options").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter(([a]) => a).slice(0, 10)
      .map(([a, e]) => ({ ar: a, en: e || a })),
  };
  const { error } = id ? await ctx.supabase.from("services").update(row).eq("id", id) : await ctx.supabase.from("services").insert(row);
  if (error) go("/app/services", { error: msg(error, ctx.ar) });
  revalidatePath("/app/services"); go("/app/services", { ok: "1" });
}
export async function saveFaq(form: FormData) {
  const ctx = await requireOrg(["owner", "admin"]);
  const id = s(form, "id");
  const row = { org_id: ctx.org.id, service_id: s(form, "service_id") || null, question_ar: s(form, "question_ar"), question_en: s(form, "question_en") || s(form, "question_ar"),
    answer_ar: s(form, "answer_ar"), answer_en: s(form, "answer_en") || s(form, "answer_ar"), keywords: list(s(form, "keywords")), is_active: form.get("is_active") === "on",
    handoff: ["after_filter", "yes", "urgent"].includes(s(form, "handoff")) ? s(form, "handoff") : "no", updated_at: new Date().toISOString() };
  const { error } = id ? await ctx.supabase.from("faqs").update(row).eq("id", id) : await ctx.supabase.from("faqs").insert(row);
  if (error) go("/app/services", { error: msg(error, ctx.ar) });
  revalidatePath("/app/services"); go("/app/services", { ok: "1" });
}

export async function saveSettings(form: FormData) {
  const ctx = await requireOrg(["owner", "admin"]);
  const b = (k: string) => form.get(k) === "on";
  const { error } = await ctx.supabase.rpc("save_bot_settings", { p_org: ctx.org.id, p: {
    enabled: b("enabled"), ai_enabled: b("ai_enabled"), ask_phone: b("ask_phone"),
    greeting_ar: s(form, "greeting_ar"), greeting_en: s(form, "greeting_en"), handoff_ar: s(form, "handoff_ar"), handoff_en: s(form, "handoff_en"),
    booking_flow: s(form, "booking_flow") === "intake" ? "intake" : "slots",
    intake_visit_ar: s(form, "intake_visit_ar"), intake_visit_en: s(form, "intake_visit_en"), intake_done_ar: s(form, "intake_done_ar"), intake_done_en: s(form, "intake_done_en"),
    emergency_ar: s(form, "emergency_ar"), emergency_en: s(form, "emergency_en"), medical_ar: s(form, "medical_ar"), medical_en: s(form, "medical_en"),
    comment_public_reply: b("comment_public_reply"), comment_private_reply: b("comment_private_reply"), comment_hide_spam: b("comment_hide_spam"),
    comment_escalate: b("comment_escalate"), comment_thank_positive: b("comment_thank_positive"),
    comment_replies_ar: s(form, "comment_replies_ar").split("\n").map((x) => x.trim()).filter(Boolean),
    private_message_ar: s(form, "private_message_ar"), integration_url: s(form, "integration_url"),
  } });
  if (error) go("/app/settings", { error: msg(error, ctx.ar) });
  revalidatePath("/app/settings"); go("/app/settings", { ok: "1" });
}
export async function rotateSecret() {
  const ctx = await requireOrg(["owner"]);
  const { error } = await ctx.supabase.rpc("rotate_integration_secret", { p_org: ctx.org.id });
  if (error) go("/app/settings", { error: msg(error, ctx.ar) });
  go("/app/settings", { ok: "1", show: "1" });
}

/** Platform admin (EchoWave): connect a WhatsApp number / Facebook page / Instagram account to a client. */
export async function addChannel(form: FormData) {
  const ctx = await requireOrg();
  const kind = s(form, "kind");
  const { data, error } = await ctx.supabase.from("channels").insert({ org_id: ctx.org.id, kind, external_id: s(form, "external_id"), name: s(form, "name") }).select("id").single();
  if (error) go("/app/channels", { error: msg(error, ctx.ar) });
  if (s(form, "token")) {
    const { error: e2 } = await ctx.supabase.rpc("set_channel_token", { p_channel: data!.id, p_token: s(form, "token") });
    if (e2) go("/app/channels", { error: msg(e2, ctx.ar) });
  }
  revalidatePath("/app/channels"); go("/app/channels", { ok: "1" });
}
export async function updateChannel(form: FormData) {
  const ctx = await requireOrg(["owner", "admin"]);
  const id = s(form, "id");
  const { error } = await ctx.supabase.from("channels").update({ auto_reply: form.get("auto_reply") === "on", comments: form.get("comments") === "on", is_active: form.get("is_active") === "on" }).eq("id", id);
  if (error) go("/app/channels", { error: msg(error, ctx.ar) });
  if (s(form, "token")) {
    const { error: e2 } = await ctx.supabase.rpc("set_channel_token", { p_channel: id, p_token: s(form, "token") });
    if (e2) go("/app/channels", { error: msg(e2, ctx.ar) });
  }
  revalidatePath("/app/channels"); go("/app/channels", { ok: "1" });
}
