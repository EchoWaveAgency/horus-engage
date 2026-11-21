// Golden Care intake script, end to end on the local stack: signed WhatsApp webhooks → bot → stored conversation.
// Needs: npm run stack:local, npm run demo:data, npm run content:load scripts/clients/golden-care.json --apply --replace,
// and the app on :3200 with META_MODE=dev. Synthetic data only.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://localhost:3200";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("="))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const check = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const run = Date.now().toString().slice(-6);
let n = 0;

async function send(from, message) {
  const payload = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "PN-GOLDENCARE" }, contacts: [{ wa_id: from, profile: { name: "🌸 M" } }],
    messages: [{ from, id: `wamid.gc${run}.${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] };
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", env.META_APP_SECRET).update(raw).digest("hex");
  const r = await fetch(`${BASE}/api/webhooks/meta`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
  if (r.status !== 200) throw new Error(`webhook ${r.status}`);
}
const text = (body, extra = {}) => ({ type: "text", text: { body }, ...extra });
const button = (id, title) => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const listPick = (id, title) => ({ type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } });
async function conv(phone) {
  const { data: c } = await db.from("contacts").select("id").eq("phone", `+${phone}`).single();
  const { data: v } = await db.from("conversations").select("id, status, needs_attention, handoff_reason, campaign_code, source, service:services(code)")
    .eq("contact_id", c.id).order("created_at", { ascending: false }).limit(1).single();
  const { data: m } = await db.from("messages").select("direction, body").eq("conversation_id", v.id).order("id");
  return { ...v, contactId: c.id, bot: m.filter((x) => x.direction === "out").map((x) => x.body) };
}

// 1. Click-to-WhatsApp ad D1 → filter → visit → time → name → customer service
const p1 = `2010${run}1`;
await send(p1, text("D1 عايز استفسر عن الأسنان", { referral: { source_type: "ad", source_id: "D1-AD", headline: "Golden Care Dental" } }));
let c = await conv(p1);
check(c.service?.code === "DENTAL" && c.campaign_code === "D1" && c.source === "ad", "ad D1 opens Dental, campaign and source kept");
check(c.bot.at(-1).startsWith("تمام. إيه الأقرب لحالتك؟") && c.bot.at(-1).includes("زراعة"), "dental filter question with its options");
await send(p1, listPick("opt:1", "تقويم"));
await send(p1, text("التقويم بياخد قد ايه؟"));
c = await conv(p1);
check(c.bot.at(-2).includes("مدة التقويم بتختلف") && c.bot.at(-1).startsWith("ده أول كشف ليك عندنا ولا متابعة؟"), "question mid-intake answered, then the same question again");
await send(p1, button("visit:first", "أول مرة"));
await send(p1, button("period:afternoon", "بعد الضهر"));
await send(p1, text("مني أحمد"));
c = await conv(p1);
check(c.status === "human" && c.needs_attention && c.handoff_reason === "intake_done", "after the name: waiting for customer service");
check(c.bot.at(-1).startsWith("شكراً يا مني أحمد. زميلتنا في خدمة العملاء"), "closing message with the patient's name");
const { data: contact } = await db.from("contacts").select("name").eq("id", c.contactId).single();
check(contact.name === "مني أحمد", "contact renamed to the name the patient gave");
const { data: bk } = await db.from("bookings").select("preferred_day, preferred_period, note").eq("conversation_id", c.id).single();
check(bk.preferred_day === null && bk.preferred_period === "afternoon" && bk.note === "DENTAL · تقويم · أول مرة · بعد الضهر · مني أحمد · D1", `booking request: ${bk.note}`);
await send(p1, text("تمام شكرا"));
c = await conv(p1);
check(c.bot.at(-1).startsWith("شكراً يا مني"), "the bot stays quiet once a person has the conversation");

// 2. Emergency in the middle
const p2 = `2010${run}2`;
await send(p2, text("السلام عليكم"));
await send(p2, listPick("svc:GYN", "نساء وتوليد"));
await send(p2, text("عندي نزيف وانا حامل"));
c = await conv(p2);
check(c.status === "human" && c.handoff_reason === "emergency" && c.bot.at(-1).startsWith("من فضلك اتوجهي لأقرب طوارئ فوراً"), "pregnant + bleeding → emergency answer, handed over at once");

// 3. Medicine question
const p3 = `2010${run}3`;
await send(p3, text("ممكن اخد دوا ايه للصداع"));
c = await conv(p3);
check(c.handoff_reason === "medical_question" && c.bot.at(-1).startsWith("سؤالك مهم، والإجابة عليه محتاجة الدكتور"), "medicine question → the clinic's medical reply, then a person");

// 4. Unfilled placeholder answers never reach a patient
const p4 = `2010${run}4`;
await send(p4, text("فيه ركنة؟"));
c = await conv(p4);
check(!c.bot.some((b) => b.includes("[")), "no [placeholder] ever sent");
console.log(process.exitCode ? "\nFAILED" : "\nAll Golden Care intake checks passed.");
