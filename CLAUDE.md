# CLAUDE.md — HORUS Engage

Multi-client messaging automation by EchoWave: WhatsApp, Messenger, Instagram DMs and Facebook / Instagram comments,
with a bot that answers only from each client's approved services / FAQs, books requests, and hands off to people.

## Stack
Next.js 14 (App Router, Server Actions) · Supabase (Postgres 16, Auth, RLS) · Tailwind · vitest.

## Commands
`npm run db:test` (must pass before any commit touching `supabase/`) · `npm test` · `npm run typecheck` · `npm run lint` · `npm run build`
`npm run stack:local` + `npm run demo:data` — local stack on :54331 (runs beside Golden Care's :54321). `node e2e/engage-journey.mjs` — end to end.

## Rules
1. Every row has `org_id`; RLS = `app.is_member(org_id, roles)`. Tokens (`channel_secrets`) and integration secrets (`org_secrets`) have no grants to client roles.
2. Inbound is stored first and idempotently (`svc_ingest_*`, unique provider ids, advisory lock per contact); the bot step is applied with a version check (`svc_bot_apply`). Never send before storing.
3. The engine (`src/lib/engine/`) is pure and unit-tested. It never invents content: prices / offers / answers come from `services` / `faqs`; no approved price → handoff. Medical questions, complaints, "a person please", media, and repeated misunderstanding → handoff. Every path change needs a test.
4. The language model (`src/lib/ai.ts`) only picks an intent / service / FAQ the rules already know; it never writes customer-facing text. Off unless the client enables it.
5. Once a person has a conversation (agent reply, take-over, or a reply from Meta Business Suite = echo) the bot stays quiet until handed back.
6. Comments: one private reply per comment within 7 days; own replies ignored; public replies rotate; spam / abuse hidden (never deleted).
7. Service role only in: `app/api/webhooks/meta`, `lib/runner.ts`, `lib/integration.ts` (dispatcher job), and sending a reply the agent's session just logged (`actions/inbox.ts`).
8. Bilingual UI (Arabic RTL default). Don't invent client policy (prices, hours, addresses) — leave fields empty for the client.
