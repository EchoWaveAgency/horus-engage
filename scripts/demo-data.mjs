// SYNTHETIC demo data for local development / staging only: EchoWave platform admin, the Golden Care client with
// three channels, two call-center agents, a second client (isolation), and the Golden Friday services.
// Service texts are DRAFTS for the clinic to review; prices marked "تجريبي" are placeholders, never real prices.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url?.includes("localhost") && process.env.DEMO_ALLOW_REMOTE !== "yes") throw new Error("demo data only on a local stack (set DEMO_ALLOW_REMOTE=yes for staging)");
const db = createClient(url, key, { auth: { persistSession: false } });
const PASSWORD = process.env.DEMO_PASSWORD ?? "HorusEngage-Demo-2026";
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

const people = [
  { email: "admin@echowave.demo", name: "EchoWave Admin", platform: true },
  { email: "owner@goldencare.demo", name: "مدير العيادة", org: "golden-care", role: "owner" },
  { email: "cc1@goldencare.demo", name: "أحمد — كول سنتر", org: "golden-care", role: "agent" },
  { email: "cc2@goldencare.demo", name: "منة — كول سنتر", org: "golden-care", role: "agent" },
  { email: "marketing@goldencare.demo", name: "التسويق", org: "golden-care", role: "viewer" },
  { email: "agent@otherclinic.demo", name: "Other Clinic Agent", org: "other-clinic", role: "agent" },
];
const orgs = [{ slug: "golden-care", name: "Golden Care Clinics" }, { slug: "other-clinic", name: "Other Clinic (demo)" }];
const orgIds = {};
for (const o of orgs) {
  const existing = must(await db.from("orgs").select("id").eq("slug", o.slug).maybeSingle(), "org");
  orgIds[o.slug] = existing?.id ?? must(await db.from("orgs").insert(o).select("id").single(), o.slug).id;
}
const list = must(await db.auth.admin.listUsers({ perPage: 200 }), "users").users;
for (const p of people) {
  let u = list.find((x) => x.email === p.email);
  if (!u) u = must(await db.auth.admin.createUser({ email: p.email, password: PASSWORD, email_confirm: true }), p.email).user;
  must(await db.from("profiles").upsert({ user_id: u.id, full_name: p.name, is_platform_admin: Boolean(p.platform) }), "profile");
  if (p.org) must(await db.from("org_members").upsert({ org_id: orgIds[p.org], user_id: u.id, role: p.role }), "member");
}
const gc = orgIds["golden-care"];
const channels = [
  { org_id: gc, kind: "whatsapp", external_id: "PN-GOLDENCARE", name: "Golden Care WhatsApp" },
  { org_id: gc, kind: "messenger", external_id: "PAGE-GOLDENCARE", name: "Golden Care Clinics (Facebook)" },
  { org_id: gc, kind: "instagram", external_id: "IG-GOLDENCARE", name: "@goldencare.clinics" },
  { org_id: orgIds["other-clinic"], kind: "messenger", external_id: "PAGE-OTHER", name: "Other clinic page" },
];
for (const c of channels) {
  const row = must(await db.from("channels").upsert(c, { onConflict: "kind,external_id" }).select("id").single(), c.name);
  must(await db.from("channel_secrets").upsert({ channel_id: row.id, access_token: "local-dev-token-not-real-000000" }), "token");
}
const S = (code, name_ar, name_en, summary_ar, summary_en, keywords, extra = {}) => ({ org_id: gc, code, name_ar, name_en, summary_ar, summary_en, keywords,
  campaign_codes: [`GF26-${code}`], ...extra });
const services = [
  S("LASER", "إزالة الشعر بالليزر", "Laser hair removal", "جلسات إزالة الشعر بالليزر لكل مناطق الجسم مع أخصائيات مدرّبات. (نص مبدئي — للمراجعة)",
    "Laser hair removal for all body areas with trained specialists. (draft)", ["ليزر", "ازاله الشعر", "laser"],
    { offer_ar: "عرض الجمعة الذهبية (نص مبدئي — للمراجعة)", price_ar: "سعر تجريبي 500 جنيه — يُستبدل بالسعر المعتمد", duration_ar: "حوالي 30–60 دقيقة حسب المنطقة", sort: 1 }),
  S("DENTAL", "الأسنان", "Dental", "كشف وتنظيف وتبييض وتقويم الأسنان. (نص مبدئي — للمراجعة)", "Check-up, cleaning, whitening and braces. (draft)",
    ["اسنان", "سنان", "تبييض", "تقويم", "dental", "teeth"], { offer_ar: "عرض الجمعة الذهبية (نص مبدئي — للمراجعة)", sort: 2 }),
  S("SKIN", "العناية بالبشرة", "Skin care", "جلسات تنظيف ونضارة البشرة. (نص مبدئي — للمراجعة)", "Facials and skin treatments. (draft)",
    ["بشره", "جلديه", "تنظيف بشره", "skin", "facial"], { sort: 3 }),
  S("CHECKUP", "الفحص الشامل", "Full check-up", "فحص شامل مع الطبيب. (نص مبدئي — للمراجعة)", "Full check-up with the doctor. (draft)",
    ["فحص", "تشيك اب", "checkup"], { booking_mode: "human_only", sort: 4 }),
  S("OFFER", "عروض الجمعة الذهبية", "Golden Friday offers", "كل عروض الجمعة الذهبية في مكان واحد. (نص مبدئي — للمراجعة)", "All Golden Friday offers. (draft)",
    ["عرض", "عروض", "الجمعه الذهبيه", "golden friday", "offer"], { sort: 5 }),
];
for (const s of services) must(await db.from("services").upsert(s, { onConflict: "org_id,code" }), s.code);
const { count } = await db.from("faqs").select("id", { count: "exact", head: true }).eq("org_id", gc);
if (!count) must(await db.from("faqs").insert([
  { org_id: gc, question_ar: "العنوان فين؟", question_en: "Where are you?", answer_ar: "عيادات جولدن كير — مدينة الشروق. (اكتبوا العنوان التفصيلي ولينك الخريطة)", answer_en: "Golden Care Clinics — El Shorouk City.", keywords: ["العنوان", "فين", "مكانكم", "لوكيشن", "address", "location"] },
  { org_id: gc, question_ar: "مواعيد العمل؟", question_en: "Opening hours?", answer_ar: "(اكتبوا مواعيد العمل المعتمدة هنا)", answer_en: "(add opening hours)", keywords: ["مواعيد العمل", "بتفتحوا", "بتقفلوا", "hours"] },
]), "faqs");
if (process.env.ENGAGE_INTEGRATION_URL) {
  must(await db.from("bot_settings").update({ integration_url: process.env.ENGAGE_INTEGRATION_URL }).eq("org_id", gc), "integration");
}
const sec = must(await db.from("org_secrets").select("integration_secret").eq("org_id", gc).single(), "secret");
console.log(`Demo ready. Password: ${PASSWORD}`);
for (const p of people) console.log(`  ${(p.role ?? "platform").padEnd(8)} ${p.email}`);
console.log(`GOLDEN_CARE_ENGAGE_SECRET=${sec.integration_secret}`);
