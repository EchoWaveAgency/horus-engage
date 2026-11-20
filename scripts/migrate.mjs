// Applies supabase/migrations/*.sql to the database once each (tracked in public.engage_migrations), then the
// first-run bootstrap. Runs before `next build` on Vercel when ENGAGE_MIGRATE=on and the Supabase integration has
// injected POSTGRES_URL_NON_POOLING. Each file runs in its own transaction; a failure stops the build.
//
// Bootstrap (idempotent, optional):
//   ENGAGE_ADMIN_EMAIL   — an existing Supabase Auth user (Authentication → Add user) becomes the EchoWave platform admin
//   ENGAGE_FIRST_ORG     — "slug:Name" (e.g. golden-care:Golden Care Clinics): created with the admin as owner and the
//                          Golden Friday services as DRAFTS (no prices — the client fills approved texts)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

if (process.env.ENGAGE_MIGRATE !== "on") { console.log("[migrate] ENGAGE_MIGRATE is not on — skipped"); process.exit(0); }
const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
if (!url) { console.error("[migrate] POSTGRES_URL_NON_POOLING is not set — connect the Supabase integration to this Vercel project"); process.exit(1); }

const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false } });
await client.connect();
await client.query(`create table if not exists public.engage_migrations (name text primary key, applied_at timestamptz not null default now())`);
await client.query(`alter table public.engage_migrations enable row level security; revoke all on public.engage_migrations from anon, authenticated`);
const done = new Set((await client.query("select name from public.engage_migrations")).rows.map((r) => r.name));
const dir = join(process.cwd(), "supabase", "migrations");
for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  console.log(`[migrate] applying ${f}`);
  try {
    await client.query("begin");
    await client.query(readFileSync(join(dir, f), "utf8"));
    await client.query("insert into public.engage_migrations (name) values ($1)", [f]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error(`[migrate] ${f} failed: ${e.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- bootstrap
const email = process.env.ENGAGE_ADMIN_EMAIL?.trim().toLowerCase();
if (email) {
  const u = (await client.query("select id from auth.users where lower(email) = $1", [email])).rows[0];
  if (!u) console.warn(`[bootstrap] ${email} is not a Supabase Auth user yet — add it in Authentication → Users, then redeploy`);
  else {
    await client.query(`insert into public.profiles (user_id, full_name, is_platform_admin) values ($1, $2, true)
      on conflict (user_id) do update set is_platform_admin = true`, [u.id, email.split("@")[0]]);
    console.log(`[bootstrap] platform admin: ${email}`);
    const first = process.env.ENGAGE_FIRST_ORG;
    if (first && first.includes(":")) {
      const [slug, ...rest] = first.split(":");
      const name = rest.join(":").trim();
      const org = (await client.query(`insert into public.orgs (slug, name) values ($1, $2) on conflict (slug) do update set name = public.orgs.name returning id`, [slug.trim(), name])).rows[0];
      await client.query(`insert into public.org_members (org_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing`, [org.id, u.id]);
      const drafts = [
        ["LASER", "إزالة الشعر بالليزر", "Laser hair removal", ["ليزر", "ازاله الشعر", "laser"], 1, "request"],
        ["DENTAL", "الأسنان", "Dental", ["اسنان", "سنان", "تبييض", "تقويم", "dental", "teeth"], 2, "request"],
        ["SKIN", "العناية بالبشرة", "Skin care", ["بشره", "جلديه", "تنظيف بشره", "skin", "facial"], 3, "request"],
        ["CHECKUP", "الفحص الشامل", "Full check-up", ["فحص", "تشيك اب", "checkup"], 4, "human_only"],
        ["OFFER", "عروض الجمعة الذهبية", "Golden Friday offers", ["عرض", "عروض", "الجمعه الذهبيه", "golden friday", "offer"], 5, "request"],
      ];
      if (slug.trim() === "golden-care") {
        for (const [code, ar, en, kw, sort, mode] of drafts) {
          await client.query(`insert into public.services (org_id, code, name_ar, name_en, summary_ar, summary_en, keywords, campaign_codes, sort, booking_mode)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (org_id, code) do nothing`,
            [org.id, code, ar, en, `${ar} — (اكتبوا الوصف المعتمد هنا)`, `${en} — (approved description)`, kw, [`GF26-${code}`], sort, mode]);
        }
      }
      console.log(`[bootstrap] org ${slug} ready (owner ${email})`);
    }
  }
}
await client.end();
console.log("[migrate] database up to date");
