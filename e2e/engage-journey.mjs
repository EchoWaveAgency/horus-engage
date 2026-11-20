// HORUS Engage end to end, on two running local stacks: Engage (:3200) and Golden Care OS (:3100).
// Signed Meta webhooks → bot → booking → signed event → Golden Care call-center lead; handoff → agent reply; comments.
// META_MODE=dev: replies are logged, not sent to Meta. Synthetic data only.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3200", GC = "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "/tmp/";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("="))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const PASS = "HorusEngage-Demo-2026";
const check = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: "shell", defaultViewport: { width: 1360, height: 900 } });
const shot = async (p, n) => { const tall = await p.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 40); await p.screenshot({ path: `${OUT}${n}.png`, fullPage: tall }); };
const text = (p) => p.evaluate(() => document.body.innerText);

async function hook(payload, { sign = true } = {}) {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", env.META_APP_SECRET).update(raw).digest("hex");
  const r = await fetch(`${BASE}/api/webhooks/meta`, { method: "POST", headers: { "Content-Type": "application/json", ...(sign ? { "X-Hub-Signature-256": sig } : {}) }, body: raw });
  return { status: r.status, body: await r.json().catch(() => null) };
}
let n = 0;
const wa = (text, extra = {}) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
  metadata: { phone_number_id: "PN-GOLDENCARE" }, contacts: [{ wa_id: "201005556677", profile: { name: "نورا" } }],
  messages: [{ from: "201005556677", id: `wamid.e2e${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), ...extra, ...(extra.type ? {} : { type: "text", text: { body: text } }) }] } }] }] });
const waButton = (id, title, list = false) => wa(null, { type: "interactive", interactive: list ? { type: "list_reply", list_reply: { id, title } } : { type: "button_reply", button_reply: { id, title } } });
const ms = (psid, text, extra = {}) => ({ object: "page", entry: [{ id: "PAGE-GOLDENCARE", messaging: [{ sender: { id: psid }, recipient: { id: "PAGE-GOLDENCARE" }, timestamp: Date.now(), message: { mid: `m.e2e${++n}`, text, ...extra } }] }] });
const fbComment = (id, msg, name) => ({ object: "page", entry: [{ id: "PAGE-GOLDENCARE", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: id, post_id: "PAGE_post1",
  parent_id: "PAGE_post1", from: { id: `U-${id}`, name }, message: msg, created_time: Math.floor(Date.now() / 1000) } }] }] });
const igComment = (id, msg, user) => ({ object: "instagram", entry: [{ id: "IG-GOLDENCARE", changes: [{ field: "comments", value: { id, text: msg, from: { id: `IGU-${id}`, username: user }, media: { id: "MED1" } } }] }] });

async function login(email) {
  const page = await (await browser.createBrowserContext()).newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email); await page.type("#password", PASS);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button")]);
  return page;
}
const submit = (p, sel) => Promise.all([p.waitForNavigation({ waitUntil: "networkidle0" }), p.click(sel)]);
async function dispatch() {
  const r = await fetch(`${BASE}/api/jobs/dispatch`, { method: "POST", headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
  return r.json();
}
const last = (r) => r.body?.results?.[0];

// ---------- Security
check((await hook(wa("x"), { sign: false })).status === 401, "unsigned Meta webhook rejected (401)");
const v = await fetch(`${BASE}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${env.META_VERIFY_TOKEN}&hub.challenge=777`);
check((await v.text()) === "777", "Meta verification handshake");

// ---------- WhatsApp: Click-to-WhatsApp ad with campaign code → service card → booking → Golden Care
let r = await hook(wa("مرحبا عايزة اعرف عرض GF26-LASER", { referral: { source_id: "120219990001", source_type: "ad", headline: "الجمعة الذهبية — ليزر", ctwa_clid: "CLK" } }));
check(r.status === 200 && last(r)?.handled === "answered", "1. first WhatsApp message answered automatically");
r = await hook(waButton("book", "احجز الآن"));
check(last(r)?.handled === "answered", "2. 'Book now' → day list");
const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
r = await hook(waButton(`day:${tomorrow}`, "بكرة", true));
r = await hook(waButton("period:evening", "بالليل"));
check(last(r)?.handled === "booking", "3. day + time → booking request");
const d = await dispatch();
check(d.events?.sent >= 1 && d.events?.failed === 0, `4. events delivered to Golden Care (sent ${d.events?.sent}, failed ${d.events?.failed})`);

// ---------- Messenger: menu → price (approved) → medical question → handoff → agent reply → bot silent
r = await hook(ms("PSID-E2E", "السلام عليكم"));
check(last(r)?.handled === "answered", "5. Messenger greeting → service menu");
r = await hook(ms("PSID-E2E", "ليزر", { quick_reply: { payload: "svc:LASER" } }));
r = await hook(ms("PSID-E2E", "بكام الجلسة؟"));
check(last(r)?.handled === "answered", "6. price answered from the approved text");
r = await hook(ms("PSID-E2E", "أنا حامل ينفع أعمل ليزر؟"));
check(last(r)?.handled === "handoff" && last(r)?.reason === "medical_question", "7. medical question → handed to a person (bot never answers it)");
r = await hook(ms("PSID-E2E", "حد يرد عليا"));
check(last(r)?.handled === "with_agent", "8. bot stays quiet once a person has the conversation");

// ---------- Comments
r = await hook(fbComment("cm-price", "بكام الليزر؟", "Hala Samir"));
check(last(r)?.handled === "price" && last(r)?.status === "auto_handled", "9. Facebook price comment → public reply + private DM with the menu");
r = await hook(fbComment("cm-spam", "اربح 5000 جنيه يوميا من البيت ادخل https://x.co", "Spammer"));
check(last(r)?.handled === "spam", "10. spam comment hidden automatically");
r = await hook(igComment("ig-complaint", "اسوأ تجربة، محدش بيرد", "angry.user"));
check(last(r)?.handled === "complaint" && last(r)?.status === "needs_human", "11. Instagram complaint → apology + DM + needs a person");
r = await hook(fbComment("cm-price", "بكام الليزر؟", "Hala Samir"));
check(last(r)?.handled === "duplicate", "12. Meta retry of the same comment ignored");
r = await hook(ms("PSID-from-cm-price", "2"));
check(last(r)?.handled === "answered", "13. person who commented replies '2' in DM → service card");

// ---------- Golden Care received the booking as a call-center lead
const gcLead = await fetch(`http://localhost:54321/rest/v1/leads?select=code,source,kind,cc_status,full_name,campaign:lead_campaigns(code)&phone=eq.%2B201005556677`, {
  headers: { apikey: readFileSync("/home/claude/golden-care-os/.env.local", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1], Authorization: `Bearer ${readFileSync("/home/claude/golden-care-os/.env.local", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1]}` } }).then((x) => x.json());
check(gcLead.length === 1 && gcLead[0].kind === "booking" && gcLead[0].campaign?.code === "GF26-LASER" && gcLead[0].cc_status === "new" && /^GF26-/.test(gcLead[0].code),
  `14. Golden Care call center has the lead ${gcLead[0]?.code} (booking, GF26-LASER, NEW → SLA starts)`);

// ---------- Staff UI
const agent = await login("cc1@goldencare.demo");
await agent.goto(`${BASE}/app?v=waiting`, { waitUntil: "networkidle0" });
const inbox = await text(agent);
check(inbox.includes("سؤال طبي") && inbox.includes("شكوى"), "15. 'Needs a person' shows the medical question and the complaint with reasons");
await shot(agent, "eg-01-inbox");
await agent.goto(`${BASE}/app?v=bot`, { waitUntil: "networkidle0" });
const waConv = await agent.$$eval("[data-conv]", (els) => els.map((e) => ({ id: e.getAttribute("data-conv"), t: e.innerText })).find((x) => x.t.includes("نورا"))?.id);
await agent.goto(`${BASE}/app/c/${waConv}`, { waitUntil: "networkidle0" });
const thread = await text(agent);
check(thread.includes("طلب حجز") && /GF26-[A-Z0-9]{6}/.test(thread), `16. WhatsApp conversation shows the booking and its Golden Care id`);
await shot(agent, "eg-02-whatsapp-booking");
await agent.goto(`${BASE}/app?v=waiting`, { waitUntil: "networkidle0" });
const medConv = await agent.$$eval("[data-conv]", (els) => els.map((e) => ({ id: e.getAttribute("data-conv"), t: e.innerText })).find((x) => x.t.includes("سؤال طبي"))?.id);
await agent.goto(`${BASE}/app/c/${medConv}`, { waitUntil: "networkidle0" });
await agent.type("textarea[name=body]", "أهلاً بيكي، أنا أحمد من خدمة العملاء — هنكلمك مع الطبيبة للتأكيد.");
await submit(agent, "form:has(textarea[name=body]) button");
check((await text(agent)).includes("أنا أحمد من خدمة العملاء"), "17. agent replies from the inbox (sent through Meta, logged)");
await shot(agent, "eg-03-agent-reply");
await agent.goto(`${BASE}/app/comments?v=all`, { waitUntil: "networkidle0" });
const cm = await text(agent);
check(cm.includes("سبام") && cm.includes("مخفي") && cm.includes("شكوى") && cm.includes("رسالة خاصة"), "18. comments page: spam hidden, complaint flagged, DM sent");
await shot(agent, "eg-04-comments");

const other = await login("agent@otherclinic.demo");
await other.goto(`${BASE}/app?v=human`, { waitUntil: "networkidle0" });
await other.goto(`${BASE}/app/c/${medConv}`, { waitUntil: "networkidle0" });
check((await text(other)).includes("غير موجودة") || (await text(other)).includes("not found"), "19. another client cannot open Golden Care conversations");
const viewer = await login("marketing@goldencare.demo");
await viewer.goto(`${BASE}/app/c/${medConv}`, { waitUntil: "networkidle0" });
check(!(await viewer.$("textarea[name=body]")), "20. viewer (marketing) can read but not reply");
await viewer.goto(`${BASE}/app/reports?d=1`, { waitUntil: "networkidle0" });
const rep = await viewer.$$eval("[data-report] .num", (e) => e.map((x) => x.textContent));
check(rep[0] === "4" && rep[1] === "1", `21. reports from the database: conversations ${rep[0]}, booking requests ${rep[1]}`);
await shot(viewer, "eg-05-reports");
const owner = await login("owner@goldencare.demo");
await owner.goto(`${BASE}/app/services`, { waitUntil: "networkidle0" });
check((await text(owner)).includes("بدون سعر معتمد"), "22. services page flags services without an approved price");
await shot(owner, "eg-06-services");
await owner.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await owner.goto(`${BASE}/app?v=waiting`, { waitUntil: "networkidle0" });
await shot(owner, "eg-07-inbox-mobile");
await browser.close();
