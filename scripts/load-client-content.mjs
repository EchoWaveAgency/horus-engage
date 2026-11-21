// Loads a client's approved bot content (settings, services, FAQs) from a JSON file such as scripts/clients/golden-care.json.
// Dry run by default — prints what would change. Writes only with --apply. Never deletes:
//   --replace   also turns OFF this client's active services that are not in the file.
// Anything still holding an unfilled [placeholder] is saved inactive (the database refuses it active anyway).
//
//   node --env-file=.env.local scripts/load-client-content.mjs scripts/clients/golden-care.json            # dry run
//   node --env-file=.env.local scripts/load-client-content.mjs scripts/clients/golden-care.json --apply    # write
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [file, ...flags] = process.argv.slice(2);
if (!file) throw new Error("usage: load-client-content.mjs <file.json> [--apply] [--replace]");
const apply = flags.includes("--apply"), replace = flags.includes("--replace");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db = createClient(url, key, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const placeholder = (t) => /\[[^\]]*\]/.test(t ?? "");
const content = JSON.parse(readFileSync(file, "utf8"));

const org = must(await db.from("orgs").select("id, name").eq("slug", content.org_slug).maybeSingle(), "org");
if (!org) throw new Error(`no client with slug "${content.org_slug}"`);
console.log(`${apply ? "APPLY" : "DRY RUN"} — ${org.name} (${content.org_slug})${replace ? " — replace services" : ""}\n`);

// Settings
const settingKeys = ["booking_flow", "intake_visit_ar", "intake_visit_en", "intake_done_ar", "intake_done_en", "handoff_ar", "handoff_en",
  "emergency_ar", "emergency_en", "medical_ar", "medical_en", "greeting_ar", "greeting_en"];
const settings = Object.fromEntries(Object.entries(content.settings ?? {}).filter(([k]) => settingKeys.includes(k)));
for (const [k, v] of Object.entries(settings)) if (placeholder(v)) throw new Error(`setting ${k} still has a [placeholder]`);
console.log(`settings: ${Object.keys(settings).join(", ")}`);
if (apply) must(await db.from("bot_settings").update({ ...settings, updated_at: new Date().toISOString() }).eq("org_id", org.id), "settings");

// Services (campaign codes already on a service are kept, e.g. Golden Friday codes)
const existing = must(await db.from("services").select("id, code, summary_ar, summary_en, campaign_codes, is_active").eq("org_id", org.id), "services");
const byCode = new Map(existing.map((s) => [s.code, s]));
const ids = {};
for (const s of content.services) {
  const old = byCode.get(s.code);
  const row = {
    org_id: org.id, code: s.code, name_ar: s.name_ar, name_en: s.name_en,
    summary_ar: s.summary_ar ?? old?.summary_ar ?? s.name_ar, summary_en: s.summary_en ?? old?.summary_en ?? s.name_en,
    keywords: s.keywords ?? [], campaign_codes: [...new Set([...(old?.campaign_codes ?? []), ...(s.campaign_codes ?? [])])],
    filter_question_ar: s.filter_question_ar ?? null, filter_question_en: s.filter_question_en ?? null, filter_options: s.filter_options ?? [],
    sort: s.sort ?? 100, is_active: true,
  };
  console.log(`service ${old ? "update" : "new   "} ${s.code.padEnd(10)} ${s.name_ar}${row.filter_question_ar ? ` — ${row.filter_options.length} options` : ""}${row.campaign_codes.length ? ` [${row.campaign_codes.join(", ")}]` : ""}`);
  if (apply) ids[s.code] = must(await db.from("services").upsert(row, { onConflict: "org_id,code" }).select("id").single(), s.code).id;
  else ids[s.code] = old?.id ?? `(new ${s.code})`;
}
const others = existing.filter((s) => s.is_active && !content.services.some((c) => c.code === s.code));
for (const s of others) {
  console.log(`service ${replace ? "turn off" : "kept on "} ${s.code}${replace ? "" : "  (still in the menu — use --replace to turn it off)"}`);
  if (apply && replace) must(await db.from("services").update({ is_active: false }).eq("id", s.id), s.code);
}

// FAQs (matched by service + Arabic question)
const faqs = must(await db.from("faqs").select("id, service_id, question_ar").eq("org_id", org.id), "faqs");
const pending = [];
let added = 0, updated = 0;
for (const f of content.faqs) {
  const service_id = f.service ? ids[f.service] : null;
  if (f.service && !service_id) throw new Error(`FAQ "${f.question_ar}" points at unknown service ${f.service}`);
  const active = Boolean(f.active) && !placeholder(f.answer_ar) && !placeholder(f.answer_en);
  if (!active) pending.push(`${f.service ?? "عام"} — ${f.question_ar}`);
  const row = { org_id: org.id, service_id: apply ? service_id : null, question_ar: f.question_ar, question_en: f.question_en || f.question_ar,
    answer_ar: f.answer_ar, answer_en: f.answer_en || f.answer_ar, keywords: f.keywords, handoff: f.handoff ?? "no", is_active: active,
    updated_at: new Date().toISOString() };
  const old = faqs.find((x) => x.question_ar === f.question_ar && (x.service_id ?? null) === (typeof service_id === "string" && !service_id.startsWith("(") ? service_id : null));
  if (old) updated++; else added++;
  if (!apply) continue;
  if (old) must(await db.from("faqs").update(row).eq("id", old.id), f.question_ar);
  else must(await db.from("faqs").insert(row), f.question_ar);
}
const leftover = must(await db.from("faqs").select("question_ar").eq("org_id", org.id).eq("is_active", true), "faqs")
  .filter((x) => !content.faqs.some((f) => f.question_ar === x.question_ar));
if (leftover.length) console.log(`\nactive FAQs not in the file (left as they are — switch them off in Services if outdated):\n${leftover.map((x) => `  · ${x.question_ar}`).join("\n")}`);
console.log(`\nfaqs: ${added} new, ${updated} updated, ${content.faqs.length - pending.length} active, ${pending.length} waiting for the clinic:`);
for (const p of pending) console.log(`  · ${p}`);
if (!apply) console.log("\nNothing was written. Run again with --apply.");
