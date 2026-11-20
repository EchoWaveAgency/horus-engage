-- HORUS Engage — 0001 core
-- Multi-client messaging automation: WhatsApp, Messenger, Instagram DMs and Facebook / Instagram comments.
-- Every row belongs to an organization (a client). Staff see only their organizations (RLS). Channel tokens and
-- integration secrets live in tables no client role can read; only the server's service role uses them.
-- Rules: no deletes of business records (close / archive / hide instead); every state change is logged.

create extension if not exists pgcrypto;
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Organizations, people, roles
-- ---------------------------------------------------------------------------
create table public.orgs (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name          text not null check (length(trim(name)) between 2 and 120),
  timezone      text not null default 'Africa/Cairo',
  default_lang  text not null default 'ar' check (default_lang in ('ar', 'en')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.profiles (
  user_id    uuid primary key references auth.users(id),
  full_name  text not null check (length(trim(full_name)) between 2 and 120),
  locale     text not null default 'ar' check (locale in ('ar', 'en')),
  is_platform_admin boolean not null default false,   -- EchoWave staff: create orgs, connect channels
  created_at timestamptz not null default now()
);

-- owner/admin: settings, services, channels, members; agent: inbox and comments; viewer: read-only reports.
create table public.org_members (
  org_id     uuid not null references public.orgs(id),
  user_id    uuid not null references auth.users(id),
  role       text not null check (role in ('owner', 'admin', 'agent', 'viewer')),
  is_active  boolean not null default true,
  on_duty    boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create or replace function app.is_platform_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_platform_admin from public.profiles where user_id = auth.uid()), false)
$$;

-- Caller's membership in an org, optionally with one of the given roles.
create or replace function app.is_member(p_org uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_platform_admin() or exists (
    select 1 from public.org_members m join public.orgs o on o.id = m.org_id and o.is_active
    where m.org_id = p_org and m.user_id = auth.uid() and m.is_active and (p_roles is null or m.role = any(p_roles)))
$$;
create or replace function app.require_member(p_org uuid, p_roles text[] default null)
returns void language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_member(p_org, p_roles) then raise exception 'permission denied' using errcode = '42501'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Audit (who / what / when / before / after)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  org_id     uuid,
  actor_id   uuid default auth.uid(),
  action     text not null,
  table_name text not null,
  record_id  text,
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now()
);
create index on public.audit_log (org_id, at desc);

create or replace function app.audit_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare j_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end; j_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  insert into public.audit_log (org_id, action, table_name, record_id, before, after)
  values (coalesce((j_new->>'org_id')::uuid, (j_old->>'org_id')::uuid, (j_new->>'id')::uuid), tg_op, tg_table_name,
          coalesce(j_new->>'id', j_old->>'id'), j_old - 'access_token' - 'secret', j_new - 'access_token' - 'secret');
  return coalesce(new, old);
end $$;

create or replace function app.block_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'records are never deleted here (close, archive or hide instead)' using errcode = '42501';
end $$;

create trigger trg_audit_orgs after insert or update on public.orgs for each row execute function app.audit_row();
create trigger trg_audit_members after insert or update or delete on public.org_members for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Channels (one per WhatsApp number, Facebook page, Instagram account)
-- ---------------------------------------------------------------------------
create table public.channels (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id),
  kind         text not null check (kind in ('whatsapp', 'messenger', 'instagram')),
  external_id  text not null,                -- WhatsApp phone_number_id · Facebook page id · Instagram account id
  name         text not null,
  auto_reply   boolean not null default true,   -- bot answers DMs on this channel
  comments     boolean not null default true,   -- comment automation (pages / Instagram)
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (kind, external_id)
);
-- Tokens: service role only (no grants to any client role). In production prefer Supabase Vault.
create table public.channel_secrets (
  channel_id   uuid primary key references public.channels(id),
  access_token text not null,
  updated_at   timestamptz not null default now()
);
create trigger trg_audit_channels after insert or update on public.channels for each row execute function app.audit_row();
create trigger trg_channels_no_delete before delete on public.channels for each row execute function app.block_delete();

-- ---------------------------------------------------------------------------
-- What the bot may say: services (approved answers) and FAQs, plus per-org bot settings
-- ---------------------------------------------------------------------------
create table public.services (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id),
  code           text not null check (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  name_ar        text not null, name_en text not null,
  summary_ar     text not null, summary_en text not null,       -- approved description
  offer_ar       text, offer_en text,                           -- approved current offer (e.g. Golden Friday)
  price_ar       text, price_en text,                           -- approved price text; empty = the bot never states a price
  duration_ar    text, duration_en text,
  booking_mode   text not null default 'request' check (booking_mode in ('request', 'human_only')),
  keywords       text[] not null default '{}',
  campaign_codes text[] not null default '{}',                  -- e.g. GF26-LASER in a Click-to-WhatsApp pre-filled message
  sort           int not null default 100,
  is_active      boolean not null default true,
  updated_by     uuid default auth.uid(),
  updated_at     timestamptz not null default now(),
  unique (org_id, code)
);
create table public.faqs (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id),
  service_id uuid references public.services(id),
  question_ar text not null, question_en text not null,
  answer_ar  text not null, answer_en text not null,
  keywords   text[] not null default '{}',
  is_active  boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.bot_settings (
  org_id            uuid primary key references public.orgs(id),
  enabled           boolean not null default true,
  ai_enabled        boolean not null default false,             -- language model reads free text (needs the client's approval)
  greeting_ar       text not null default 'أهلاً بيك 👋 إزاي نقدر نساعدك؟',
  greeting_en       text not null default 'Hello 👋 How can we help you?',
  handoff_ar        text not null default 'تمام، هحوّلك لحد من فريقنا يكمّل معاك حالًا 🙏',
  handoff_en        text not null default 'Sure, a member of our team will continue with you shortly 🙏',
  after_hours_ar    text, after_hours_en text,
  hours_from        time, hours_to time,                        -- null = always staffed
  max_unknown       int not null default 2 check (max_unknown between 1 and 5),
  ask_phone         boolean not null default true,              -- Messenger / Instagram: ask for a mobile before handoff or booking
  -- comments
  comment_public_reply   boolean not null default true,
  comment_private_reply  boolean not null default true,
  comment_hide_spam      boolean not null default true,
  comment_escalate       boolean not null default true,
  comment_thank_positive boolean not null default true,
  comment_replies_ar text[] not null default array['بعتنالك التفاصيل في الرسائل 💬', 'تم الرد عليك في الخاص ✨', 'شوف رسايلك، بعتنالك كل التفاصيل 🌟'],
  comment_replies_en text[] not null default array['We sent you the details in a private message 💬', 'Check your inbox, we replied there ✨'],
  comment_thanks_ar  text[] not null default array['شكرًا لذوقك 🤍', 'نورتنا 🌟'],
  comment_thanks_en  text[] not null default array['Thank you 🤍'],
  comment_complaint_ar text not null default 'نأسف جدًا لتجربتك، تواصلنا معك في الخاص لحل المشكلة 🙏',
  comment_complaint_en text not null default 'We are sorry about your experience; we have messaged you privately to resolve it 🙏',
  private_message_ar text not null default 'أهلاً {name} 👋 شكرًا لتعليقك! ده المساعد الخاص بنا، اختار الخدمة اللي تهمك:',
  private_message_en text not null default 'Hi {name} 👋 thanks for your comment! Choose the service you are interested in:',
  -- integration with the client's own system (e.g. Golden Care OS call center)
  integration_url   text,
  updated_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now()
);
create table public.org_secrets (
  org_id     uuid primary key references public.orgs(id),
  integration_secret text,              -- HMAC for events sent to integration_url
  updated_at timestamptz not null default now()
);
create trigger trg_audit_services after insert or update on public.services for each row execute function app.audit_row();
create trigger trg_audit_faqs after insert or update on public.faqs for each row execute function app.audit_row();
create trigger trg_audit_bot_settings after insert or update on public.bot_settings for each row execute function app.audit_row();
create trigger trg_services_no_delete before delete on public.services for each row execute function app.block_delete();

create or replace function app.services_normalize()
returns trigger language plpgsql as $$
begin
  new.code := upper(trim(new.code));
  new.keywords := coalesce((select array_agg(distinct lower(trim(k))) from unnest(new.keywords) k where length(trim(k)) >= 2), '{}');
  new.campaign_codes := coalesce((select array_agg(distinct upper(trim(k))) from unnest(new.campaign_codes) k where length(trim(k)) >= 3), '{}');
  new.updated_at := now();
  return new;
end $$;
create trigger trg_services_normalize before insert or update on public.services for each row execute function app.services_normalize();

-- New org → default bot settings and an integration secret.
create or replace function app.orgs_defaults()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.bot_settings (org_id) values (new.id) on conflict do nothing;
  insert into public.org_secrets (org_id, integration_secret) values (new.id, left(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 48)) on conflict do nothing;
  return new;
end $$;
create trigger trg_orgs_defaults after insert on public.orgs for each row execute function app.orgs_defaults();

-- ---------------------------------------------------------------------------
-- Contacts, conversations, messages
-- ---------------------------------------------------------------------------
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id),
  name        text,
  phone       text,                   -- E.164 when known (WhatsApp, or given in Messenger / Instagram)
  lang        text not null default 'ar' check (lang in ('ar', 'en')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.contacts (org_id, phone);
create table public.contact_identities (
  org_id      uuid not null references public.orgs(id),
  channel_kind text not null check (channel_kind in ('whatsapp', 'messenger', 'instagram')),
  external_id text not null,          -- WhatsApp number · page-scoped id · Instagram-scoped id
  contact_id  uuid not null references public.contacts(id),
  username    text,
  primary key (org_id, channel_kind, external_id)
);

create table public.conversations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id),
  channel_id     uuid not null references public.channels(id),
  contact_id     uuid not null references public.contacts(id),
  status         text not null default 'bot' check (status in ('bot', 'human', 'closed')),
  needs_attention boolean not null default false,       -- waiting for a person
  handoff_reason text,
  assigned_to    uuid references auth.users(id),
  service_id     uuid references public.services(id),
  campaign_code  text,
  source         text,                                   -- ad, comment, organic
  referral       jsonb,                                  -- ad referral (Click-to-WhatsApp / Messenger ads)
  bot_state      jsonb not null default '{}',
  version        int not null default 0,
  first_inbound_at timestamptz,
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  first_human_reply_at timestamptz,
  handoff_at     timestamptz,
  booked_at      timestamptz,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index conversations_one_open on public.conversations (channel_id, contact_id) where status <> 'closed';
create index on public.conversations (org_id, status, needs_attention, last_inbound_at desc);

create table public.messages (
  id                  bigint generated always as identity primary key,
  org_id              uuid not null references public.orgs(id),
  conversation_id     uuid not null references public.conversations(id),
  direction           text not null check (direction in ('in', 'out')),
  author              text not null check (author in ('contact', 'bot', 'agent', 'system')),
  kind                text not null default 'text' check (kind in ('text', 'buttons', 'list', 'media', 'audio', 'other')),
  body                text not null check (length(body) between 1 and 4096),
  payload             jsonb,                             -- buttons / list rows / button id the contact tapped
  provider_message_id text unique,
  status              text not null default 'received' check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error               text,
  agent_id            uuid references auth.users(id),
  created_at          timestamptz not null default now()
);
create index on public.messages (conversation_id, created_at);
create index messages_queued on public.messages (created_at) where status = 'queued';

create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id),
  conversation_id uuid not null references public.conversations(id),
  contact_id     uuid not null references public.contacts(id),
  service_id     uuid references public.services(id),
  preferred_day  text,        -- e.g. 2026-11-27
  preferred_period text,      -- morning / afternoon / evening
  note           text,
  status         text not null default 'requested' check (status in ('requested', 'confirmed', 'cancelled')),
  external_ref   text,        -- id in the client's system (e.g. Golden Care lead GF26-XXXXXX)
  created_at     timestamptz not null default now()
);
create trigger trg_audit_bookings after insert or update on public.bookings for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Comments (Facebook page posts, Instagram media)
-- ---------------------------------------------------------------------------
create table public.comments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id),
  channel_id       uuid not null references public.channels(id),
  platform         text not null check (platform in ('facebook', 'instagram')),
  external_id      text not null unique,
  post_id          text,
  parent_id        text,
  author_id        text,
  author_name      text,
  body             text not null default '',
  classification   text check (classification in ('inquiry', 'price', 'positive', 'complaint', 'spam', 'abuse', 'other')),
  status           text not null default 'new' check (status in ('new', 'auto_handled', 'needs_human', 'done', 'ignored')),
  public_reply     text,
  public_reply_id  text,
  private_reply_at timestamptz,
  conversation_id  uuid references public.conversations(id),
  hidden_at        timestamptz,
  actions          jsonb not null default '[]',          -- what the automation did, in order
  handled_by       uuid references auth.users(id),
  handled_at       timestamptz,
  received_at      timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index on public.comments (org_id, status, received_at desc);
create trigger trg_comments_no_delete before delete on public.comments for each row execute function app.block_delete();
create trigger trg_messages_no_delete before delete on public.messages for each row execute function app.block_delete();
create trigger trg_conversations_no_delete before delete on public.conversations for each row execute function app.block_delete();

-- Events for the client's system (lead, booking request, handoff), delivered with retries.
create table public.integration_outbox (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.orgs(id),
  event         text not null check (event in ('lead', 'booking_request', 'handoff', 'comment_complaint')),
  payload       jsonb not null,
  status        text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts      int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error    text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index outbox_due on public.integration_outbox (next_attempt_at) where status = 'pending';
