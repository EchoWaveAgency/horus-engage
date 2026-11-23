-- Intake flow (Golden Care "أسئلة البوت وردوده لكل تخصص", 2026-11-21).
-- A client can choose, instead of the day + time booking request, a short intake that ends with a person:
--   specialty → the specialty's filter question → first visit or follow-up → preferred time → name → handoff.
-- FAQs say what happens after the answer (stay with the bot, continue to the intake, hand to a person, or emergency).
-- Nothing with an unfilled [placeholder] can be active: the bot never says "[المبلغ] جنيه".

-- ---------------------------------------------------------------------------
-- Placeholder guard
-- ---------------------------------------------------------------------------
create or replace function app.has_placeholder(t text) returns boolean language sql immutable as $$
  select coalesce(t, '') ~ '\[[^]]*\]'
$$;
create or replace function app.options_have_placeholder(o jsonb) returns boolean language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o) = 'array' then o else '[]' end) e
                 where app.has_placeholder(e->>'ar') or app.has_placeholder(e->>'en'))
$$;
grant execute on function app.has_placeholder(text), app.options_have_placeholder(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Services: the specialty's filter question and its options
-- ---------------------------------------------------------------------------
alter table public.services
  add column filter_question_ar text,
  add column filter_question_en text,
  add column filter_options jsonb not null default '[]'
    check (jsonb_typeof(filter_options) = 'array' and jsonb_array_length(filter_options) <= 10);

alter table public.services add constraint services_placeholder_check check (not is_active or not (
  app.has_placeholder(summary_ar) or app.has_placeholder(summary_en) or app.has_placeholder(offer_ar) or app.has_placeholder(offer_en)
  or app.has_placeholder(price_ar) or app.has_placeholder(price_en) or app.has_placeholder(duration_ar) or app.has_placeholder(duration_en)
  or app.has_placeholder(filter_question_ar) or app.has_placeholder(filter_question_en) or app.options_have_placeholder(filter_options)));

-- Ad codes as short as two characters (D1, L1, N1); the engine matches them as whole tokens only.
-- Filter options are kept as [{ar, en}], trimmed, empty ones dropped, English falling back to Arabic.
create or replace function app.services_normalize()
returns trigger language plpgsql as $$
begin
  new.code := upper(trim(new.code));
  new.keywords := coalesce((select array_agg(distinct lower(trim(k))) from unnest(new.keywords) k where length(trim(k)) >= 2), '{}');
  new.campaign_codes := coalesce((select array_agg(distinct upper(trim(k))) from unnest(new.campaign_codes) k where length(trim(k)) >= 2), '{}');
  new.filter_question_ar := nullif(trim(new.filter_question_ar), '');
  new.filter_question_en := nullif(trim(new.filter_question_en), '');
  new.filter_options := coalesce((
    select jsonb_agg(jsonb_build_object('ar', left(trim(o->>'ar'), 24), 'en', left(coalesce(nullif(trim(o->>'en'), ''), trim(o->>'ar')), 24)) order by n)
    from jsonb_array_elements(case when jsonb_typeof(new.filter_options) = 'array' then new.filter_options else '[]' end) with ordinality x(o, n)
    where length(trim(coalesce(o->>'ar', ''))) > 0), '[]');
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- FAQs: what happens after the approved answer
--   no           answer, then carry on where the customer was
--   after_filter answer, then continue to the intake questions
--   yes          answer, then hand the conversation to a person
--   urgent       emergency: answer (e.g. "go to the nearest emergency") and hand to a person at once
-- ---------------------------------------------------------------------------
alter table public.faqs
  add column handoff text not null default 'no' check (handoff in ('no', 'after_filter', 'yes', 'urgent'));
alter table public.faqs add constraint faqs_placeholder_check check (not is_active or not (
  app.has_placeholder(answer_ar) or app.has_placeholder(answer_en)));

-- ---------------------------------------------------------------------------
-- Bot settings: the flow and its approved texts (empty = engine default)
-- ---------------------------------------------------------------------------
alter table public.bot_settings
  add column booking_flow   text not null default 'slots' check (booking_flow in ('slots', 'intake')),
  add column intake_visit_ar text, add column intake_visit_en text,    -- "first visit or follow-up?" (empty = not asked)
  add column intake_done_ar  text, add column intake_done_en  text,    -- after the name ({name})
  add column emergency_ar    text, add column emergency_en    text,
  add column medical_ar      text, add column medical_en      text;

create or replace function public.save_bot_settings(p_org uuid, p jsonb)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_member(p_org, array['owner', 'admin']);
  if p ? 'booking_flow' and p->>'booking_flow' not in ('slots', 'intake') then
    raise exception 'invalid booking flow' using errcode = '22023';
  end if;
  update public.bot_settings set
    enabled = coalesce((p->>'enabled')::boolean, enabled), ai_enabled = coalesce((p->>'ai_enabled')::boolean, ai_enabled),
    greeting_ar = coalesce(nullif(p->>'greeting_ar', ''), greeting_ar), greeting_en = coalesce(nullif(p->>'greeting_en', ''), greeting_en),
    handoff_ar = coalesce(nullif(p->>'handoff_ar', ''), handoff_ar), handoff_en = coalesce(nullif(p->>'handoff_en', ''), handoff_en),
    ask_phone = coalesce((p->>'ask_phone')::boolean, ask_phone),
    booking_flow = coalesce(nullif(p->>'booking_flow', ''), booking_flow),
    intake_visit_ar = case when p ? 'intake_visit_ar' then nullif(trim(p->>'intake_visit_ar'), '') else intake_visit_ar end,
    intake_visit_en = case when p ? 'intake_visit_en' then nullif(trim(p->>'intake_visit_en'), '') else intake_visit_en end,
    intake_done_ar  = case when p ? 'intake_done_ar'  then nullif(trim(p->>'intake_done_ar'), '')  else intake_done_ar end,
    intake_done_en  = case when p ? 'intake_done_en'  then nullif(trim(p->>'intake_done_en'), '')  else intake_done_en end,
    emergency_ar    = case when p ? 'emergency_ar'    then nullif(trim(p->>'emergency_ar'), '')    else emergency_ar end,
    emergency_en    = case when p ? 'emergency_en'    then nullif(trim(p->>'emergency_en'), '')    else emergency_en end,
    medical_ar      = case when p ? 'medical_ar'      then nullif(trim(p->>'medical_ar'), '')      else medical_ar end,
    medical_en      = case when p ? 'medical_en'      then nullif(trim(p->>'medical_en'), '')      else medical_en end,
    comment_public_reply = coalesce((p->>'comment_public_reply')::boolean, comment_public_reply),
    comment_private_reply = coalesce((p->>'comment_private_reply')::boolean, comment_private_reply),
    comment_hide_spam = coalesce((p->>'comment_hide_spam')::boolean, comment_hide_spam),
    comment_escalate = coalesce((p->>'comment_escalate')::boolean, comment_escalate),
    comment_thank_positive = coalesce((p->>'comment_thank_positive')::boolean, comment_thank_positive),
    comment_replies_ar = case when jsonb_typeof(p->'comment_replies_ar') = 'array' and jsonb_array_length(p->'comment_replies_ar') > 0
                              then array(select left(x, 300) from jsonb_array_elements_text(p->'comment_replies_ar') x) else comment_replies_ar end,
    private_message_ar = coalesce(nullif(p->>'private_message_ar', ''), private_message_ar),
    integration_url = case when p ? 'integration_url' then nullif(trim(p->>'integration_url'), '') else integration_url end,
    updated_by = auth.uid(), updated_at = now()
  where org_id = p_org;
  if (select integration_url from public.bot_settings where org_id = p_org) !~ '^https?://' then
    raise exception 'integration url must start with https://' using errcode = '22023';
  end if;
  if exists (select 1 from public.bot_settings where org_id = p_org and (app.has_placeholder(intake_visit_ar) or app.has_placeholder(intake_done_ar)
             or app.has_placeholder(emergency_ar) or app.has_placeholder(medical_ar) or app.has_placeholder(handoff_ar) or app.has_placeholder(greeting_ar))) then
    raise exception 'fill the [placeholder] first' using errcode = '22023';
  end if;
end $$;
