-- HORUS Engage — 0002 ingest, bot steps, staff actions, reports, RLS

-- Phone numbers to E.164 (Egypt-first). NULL when it cannot be a number.
create or replace function app.normalize_phone(t text)
returns text language plpgsql immutable parallel safe as $$
declare d text;
begin
  if t is null then return null; end if;
  d := regexp_replace(translate(t, '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[^0-9]', '', 'g');
  if d = '' then return null; end if;
  if left(d, 2) = '00' then d := substr(d, 3); end if;
  if length(d) = 11 and left(d, 2) = '01' then return '+2' || d; end if;
  if length(d) = 12 and left(d, 3) = '201' then return '+' || d; end if;
  if length(d) between 8 and 15 then return '+' || d; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Ingest a direct message (service role: webhook). Idempotent per provider message id; serialized per contact.
-- p: channel_kind, channel_external_id, contact_external_id, name, username, text, kind, payload, provider_id, at, referral
-- ---------------------------------------------------------------------------
create or replace function app.ingest_message(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare
  ch public.channels; s public.bot_settings; v_contact uuid; c public.conversations; v_new boolean := false; v_mid bigint;
  v_ext text := nullif(left(p->>'contact_external_id', 100), '');
  v_pid text := nullif(left(p->>'provider_id', 200), '');
  v_name text := nullif(left(regexp_replace(trim(coalesce(p->>'name', '')), '\s+', ' ', 'g'), 120), '');
  v_text text := left(coalesce(nullif(trim(p->>'text'), ''), '[بدون نص / no text]'), 4096);
  v_kind text := case when p->>'kind' in ('text', 'media', 'audio', 'other') then p->>'kind' else 'text' end;
  v_at timestamptz := least(coalesce(nullif(p->>'at', '')::timestamptz, now()), now());
  v_ref jsonb := case when jsonb_typeof(p->'referral') = 'object' then p->'referral' end;
begin
  select * into ch from public.channels where kind = p->>'channel_kind' and external_id = p->>'channel_external_id';
  if not found or not ch.is_active then return jsonb_build_object('action', 'unknown_channel'); end if;
  if v_ext is null then raise exception 'contact id is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('engage:' || ch.id || ':' || v_ext));
  if v_pid is not null and exists (select 1 from public.messages where provider_message_id = v_pid) then
    return jsonb_build_object('action', 'duplicate');
  end if;
  select * into s from public.bot_settings where org_id = ch.org_id;

  select contact_id into v_contact from public.contact_identities where org_id = ch.org_id and channel_kind = ch.kind and external_id = v_ext;
  if v_contact is null then
    insert into public.contacts (org_id, name, phone, lang)
    values (ch.org_id, v_name, case when ch.kind = 'whatsapp' then app.normalize_phone(v_ext) end,
            case when v_text ~ '[A-Za-z]' and v_text !~ '[؀-ۿ]' then 'en' else 'ar' end)
    returning id into v_contact;
    insert into public.contact_identities (org_id, channel_kind, external_id, contact_id, username)
    values (ch.org_id, ch.kind, v_ext, v_contact, nullif(left(p->>'username', 100), ''));
  elsif v_name is not null then
    update public.contacts set name = coalesce(name, v_name), updated_at = now() where id = v_contact;
  end if;

  select * into c from public.conversations where channel_id = ch.id and contact_id = v_contact and status <> 'closed' for update;
  if not found then
    insert into public.conversations (org_id, channel_id, contact_id, status, needs_attention, source, referral, first_inbound_at)
    values (ch.org_id, ch.id, v_contact, case when ch.auto_reply and coalesce(s.enabled, false) then 'bot' else 'human' end,
            not (ch.auto_reply and coalesce(s.enabled, false)), case when v_ref is not null then 'ad' else 'organic' end, v_ref, v_at)
    returning * into c;
    v_new := true;
  end if;
  insert into public.messages (org_id, conversation_id, direction, author, kind, body, payload, provider_message_id, created_at)
  values (ch.org_id, c.id, 'in', 'contact', v_kind, v_text, p->'payload', v_pid, v_at) returning id into v_mid;
  update public.conversations set last_inbound_at = greatest(coalesce(last_inbound_at, v_at), v_at),
    referral = coalesce(referral, v_ref), source = case when v_ref is not null and source <> 'comment' then 'ad' else source end,
    needs_attention = case when status = 'human' then true else needs_attention end, updated_at = now()
  where id = c.id returning * into c;

  return jsonb_build_object('action', case when v_new then 'new_conversation' else 'message' end, 'message_id', v_mid,
    'org_id', ch.org_id, 'conversation_id', c.id, 'version', c.version, 'status', c.status, 'bot_state', c.bot_state,
    'channel', jsonb_build_object('id', ch.id, 'kind', ch.kind, 'external_id', ch.external_id),
    'contact', (select jsonb_build_object('id', id, 'name', name, 'phone', phone, 'lang', lang, 'external_id', v_ext) from public.contacts where id = v_contact),
    'referral', c.referral, 'campaign_code', c.campaign_code);
end $$;

-- A message the business itself sent from Meta Business Suite / the phone app (echo): a person is handling it,
-- so the bot goes quiet on that conversation.
create or replace function app.ingest_echo(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare ch public.channels; v_contact uuid; c public.conversations; v_pid text := nullif(left(p->>'provider_id', 200), '');
begin
  select * into ch from public.channels where kind = p->>'channel_kind' and external_id = p->>'channel_external_id';
  if not found then return jsonb_build_object('action', 'unknown_channel'); end if;
  if v_pid is not null and exists (select 1 from public.messages where provider_message_id = v_pid) then
    return jsonb_build_object('action', 'own');   -- sent by Engage itself
  end if;
  select contact_id into v_contact from public.contact_identities where org_id = ch.org_id and channel_kind = ch.kind and external_id = p->>'contact_external_id';
  if v_contact is null then return jsonb_build_object('action', 'unknown_contact'); end if;
  select * into c from public.conversations where channel_id = ch.id and contact_id = v_contact and status <> 'closed' for update;
  if not found then return jsonb_build_object('action', 'no_conversation'); end if;
  insert into public.messages (org_id, conversation_id, direction, author, kind, body, provider_message_id, status)
  values (ch.org_id, c.id, 'out', 'agent', 'text', left(coalesce(nullif(p->>'text', ''), '[رسالة / message]'), 4096), v_pid, 'sent');
  update public.conversations set status = 'human', needs_attention = false, last_outbound_at = now(),
    first_human_reply_at = coalesce(first_human_reply_at, now()), version = version + 1, updated_at = now()
  where id = c.id;
  return jsonb_build_object('action', 'human_took_over', 'conversation_id', c.id);
end $$;

-- Event for the client's system (payload carries contact, service, campaign, booking and the last messages).
create or replace function app.queue_event(p_conv uuid, p_event text, p_extra jsonb default '{}')
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.conversations; s public.bot_settings;
begin
  select * into c from public.conversations where id = p_conv;
  select * into s from public.bot_settings where org_id = c.org_id;
  if s.integration_url is null then return; end if;
  insert into public.integration_outbox (org_id, event, payload)
  select c.org_id, p_event, jsonb_build_object(
    'event', p_event, 'event_id', gen_random_uuid(), 'at', now(), 'org', o.slug,
    'conversation_id', c.id, 'channel', ch.kind, 'source', c.source, 'campaign_code', c.campaign_code, 'referral', c.referral,
    'service_code', sv.code, 'handoff_reason', c.handoff_reason,
    'contact', jsonb_build_object('name', ct.name, 'phone', ct.phone, 'lang', ct.lang),
    'transcript', (select coalesce(jsonb_agg(jsonb_build_object('at', m.created_at, 'from', m.author, 'text', m.body) order by m.created_at), '[]')
                   from (select * from public.messages where conversation_id = c.id order by created_at desc limit 15) m)
  ) || p_extra
  from public.orgs o, public.channels ch, public.contacts ct
  left join public.services sv on sv.id = c.service_id
  where o.id = c.org_id and ch.id = c.channel_id and ct.id = c.contact_id;
end $$;

-- ---------------------------------------------------------------------------
-- The bot's step, applied atomically with an optimistic version check (two runners can never both answer).
-- p: state, status ('bot'|'human'|'closed'), handoff_reason, service_code, campaign_code, contact {name, phone, lang},
--    messages [{kind, body, payload}], booking {day, period, note}
-- ---------------------------------------------------------------------------
create or replace function app.bot_apply(p_conv uuid, p_version int, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.conversations; v_ids bigint[] := '{}'; v_id bigint; m jsonb; v_service uuid; v_handoff boolean; v_booking uuid; v_phone text;
begin
  select * into c from public.conversations where id = p_conv for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if c.version <> p_version then raise exception 'conversation changed' using errcode = '40001'; end if;
  if c.status <> 'bot' then raise exception 'conversation is not with the bot' using errcode = '40001'; end if;
  if nullif(p->>'service_code', '') is not null then
    select id into v_service from public.services where org_id = c.org_id and code = upper(p->>'service_code');
  end if;
  if jsonb_typeof(p->'contact') = 'object' then
    v_phone := app.normalize_phone(p->'contact'->>'phone');
    if nullif(p->'contact'->>'phone', '') is not null and v_phone is null then raise exception 'invalid phone number' using errcode = '22023'; end if;
    update public.contacts set name = coalesce(nullif(left(trim(p->'contact'->>'name'), 120), ''), name),
      phone = coalesce(v_phone, phone), lang = case when p->'contact'->>'lang' in ('ar', 'en') then p->'contact'->>'lang' else lang end, updated_at = now()
    where id = c.contact_id;
  end if;
  v_handoff := coalesce(p->>'status', '') = 'human';
  for m in select * from jsonb_array_elements(coalesce(p->'messages', '[]')) loop
    insert into public.messages (org_id, conversation_id, direction, author, kind, body, payload, status)
    values (c.org_id, c.id, 'out', 'bot', coalesce(m->>'kind', 'text'), left(m->>'body', 4096), m->'payload', 'queued') returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  update public.conversations set
    bot_state = coalesce(p->'state', bot_state), version = version + 1,
    status = case when p->>'status' in ('bot', 'human', 'closed') then p->>'status' else status end,
    needs_attention = needs_attention or v_handoff,
    handoff_reason = case when v_handoff then left(p->>'handoff_reason', 200) else handoff_reason end,
    handoff_at = case when v_handoff then now() else handoff_at end,
    service_id = coalesce(v_service, service_id), campaign_code = coalesce(nullif(upper(p->>'campaign_code'), ''), campaign_code),
    last_outbound_at = case when cardinality(v_ids) > 0 then now() else last_outbound_at end,
    closed_at = case when p->>'status' = 'closed' then now() else closed_at end, updated_at = now()
  where id = c.id returning * into c;
  if jsonb_typeof(p->'booking') = 'object' then
    insert into public.bookings (org_id, conversation_id, contact_id, service_id, preferred_day, preferred_period, note)
    values (c.org_id, c.id, c.contact_id, c.service_id, left(p->'booking'->>'day', 20), left(p->'booking'->>'period', 20), left(p->'booking'->>'note', 500))
    returning id into v_booking;
    update public.conversations set booked_at = now() where id = c.id;
    perform app.queue_event(c.id, 'booking_request', jsonb_build_object('booking', jsonb_build_object('id', v_booking,
      'day', p->'booking'->>'day', 'period', p->'booking'->>'period', 'note', p->'booking'->>'note')));
  elsif v_handoff then
    perform app.queue_event(c.id, 'handoff');
  elsif (select phone from public.contacts where id = c.contact_id) is not null
        and not exists (select 1 from public.integration_outbox o where o.payload->>'conversation_id' = c.id::text) then
    perform app.queue_event(c.id, 'lead');    -- first time we know who it is
  end if;
  return jsonb_build_object('message_ids', to_jsonb(v_ids), 'version', c.version, 'status', c.status, 'booking_id', v_booking);
end $$;

create or replace function app.message_result(p_id bigint, p_ok boolean, p_provider_id text, p_error text)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  update public.messages set status = case when p_ok then 'sent' else 'failed' end,
    provider_message_id = coalesce(nullif(p_provider_id, ''), provider_message_id), error = case when p_ok then null else left(p_error, 500) end
  where id = p_id and direction = 'out'
$$;
create or replace function app.message_status(p_provider_id text, p_status text)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  update public.messages set status = p_status
  where provider_message_id = p_provider_id and direction = 'out' and p_status in ('delivered', 'read', 'failed')
    and (case status when 'queued' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 4 end)
      < (case p_status when 'delivered' then 2 when 'read' then 3 else 4 end)
$$;

-- ---------------------------------------------------------------------------
-- Comments
-- p: platform (facebook|instagram), channel_external_id (page id / IG account id), comment_id, post_id, parent_id,
--    author_id, author_name, text, at
-- ---------------------------------------------------------------------------
create or replace function app.ingest_comment(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare ch public.channels; v_id uuid;
begin
  select * into ch from public.channels
  where kind = case when p->>'platform' = 'instagram' then 'instagram' else 'messenger' end and external_id = p->>'channel_external_id';
  if not found or not ch.is_active or not ch.comments then return jsonb_build_object('action', 'ignored_channel'); end if;
  if p->>'author_id' = ch.external_id then return jsonb_build_object('action', 'own'); end if;   -- our own replies
  insert into public.comments (org_id, channel_id, platform, external_id, post_id, parent_id, author_id, author_name, body, received_at)
  values (ch.org_id, ch.id, p->>'platform', p->>'comment_id', nullif(p->>'post_id', ''), nullif(p->>'parent_id', ''),
          nullif(p->>'author_id', ''), nullif(left(p->>'author_name', 120), ''), left(coalesce(p->>'text', ''), 4000),
          least(coalesce(nullif(p->>'at', '')::timestamptz, now()), now()))
  on conflict (external_id) do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('action', 'duplicate'); end if;
  return jsonb_build_object('action', 'new', 'comment_id', v_id, 'org_id', ch.org_id,
    'channel', jsonb_build_object('id', ch.id, 'kind', ch.kind, 'external_id', ch.external_id));
end $$;

-- Result of the automation (or a person) on a comment. p: classification, status, public_reply, public_reply_id,
-- private_reply (bool), hidden (bool), action (text appended to the log), conversation_id
create or replace function app.comment_result(p_comment uuid, p jsonb)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare cm public.comments;
begin
  select * into cm from public.comments where id = p_comment for update;
  if not found then raise exception 'comment not found' using errcode = 'P0002'; end if;
  update public.comments set
    classification = coalesce(nullif(p->>'classification', ''), classification),
    status = coalesce(nullif(p->>'status', ''), status),
    public_reply = coalesce(nullif(p->>'public_reply', ''), public_reply),
    public_reply_id = coalesce(nullif(p->>'public_reply_id', ''), public_reply_id),
    private_reply_at = case when (p->>'private_reply')::boolean then coalesce(private_reply_at, now()) else private_reply_at end,
    hidden_at = case when (p->>'hidden')::boolean then coalesce(hidden_at, now()) when (p->>'hidden')::boolean is false then null else hidden_at end,
    conversation_id = coalesce(nullif(p->>'conversation_id', '')::uuid, conversation_id),
    actions = actions || case when p ? 'action' then jsonb_build_array(jsonb_build_object('at', now(), 'by', coalesce(auth.uid()::text, 'automation'), 'what', left(p->>'action', 300))) else '[]'::jsonb end,
    handled_by = case when p->>'status' in ('done', 'ignored') then auth.uid() else handled_by end,
    handled_at = case when p->>'status' in ('done', 'ignored', 'auto_handled') then now() else handled_at end
  where id = cm.id;
end $$;

-- After a private reply to a comment: the person now has a DM thread; open a conversation waiting on the service menu.
create or replace function app.comment_conversation(p_comment uuid, p_contact_external_id text, p_state jsonb, p_body text, p_provider_id text)
returns uuid language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare cm public.comments; ch public.channels; v_contact uuid; c public.conversations;
begin
  select * into cm from public.comments where id = p_comment;
  select * into ch from public.channels where id = cm.channel_id;
  perform pg_advisory_xact_lock(hashtext('engage:' || ch.id || ':' || p_contact_external_id));
  select contact_id into v_contact from public.contact_identities where org_id = ch.org_id and channel_kind = ch.kind and external_id = p_contact_external_id;
  if v_contact is null then
    insert into public.contacts (org_id, name) values (ch.org_id, cm.author_name) returning id into v_contact;
    insert into public.contact_identities (org_id, channel_kind, external_id, contact_id) values (ch.org_id, ch.kind, p_contact_external_id, v_contact);
  end if;
  select * into c from public.conversations where channel_id = ch.id and contact_id = v_contact and status <> 'closed' for update;
  if not found then
    insert into public.conversations (org_id, channel_id, contact_id, status, source, bot_state)
    values (ch.org_id, ch.id, v_contact, 'bot', 'comment', coalesce(p_state, '{}')) returning * into c;
  end if;
  insert into public.messages (org_id, conversation_id, direction, author, kind, body, provider_message_id, status)
  values (ch.org_id, c.id, 'out', 'bot', 'text', left(p_body, 4096), nullif(p_provider_id, ''), 'sent');
  update public.conversations set last_outbound_at = now(), updated_at = now() where id = c.id;
  update public.comments set conversation_id = c.id where id = cm.id;
  return c.id;
end $$;

-- Integration outbox (dispatcher job)
create or replace function app.outbox_claim(p_limit int)
returns setof public.integration_outbox language sql volatile security definer set search_path = public, pg_temp as $$
  update public.integration_outbox set attempts = attempts + 1, next_attempt_at = now() + make_interval(mins => least(60, (attempts + 1) * (attempts + 1)))
  where id in (select id from public.integration_outbox where status = 'pending' and next_attempt_at <= now()
               order by id limit greatest(1, least(p_limit, 50)) for update skip locked)
  returning *
$$;
create or replace function app.outbox_result(p_id bigint, p_ok boolean, p_error text, p_external_ref text default null)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare o public.integration_outbox;
begin
  update public.integration_outbox set status = case when p_ok then 'sent' when attempts >= 8 then 'failed' else 'pending' end,
    sent_at = case when p_ok then now() end, last_error = case when p_ok then null else left(p_error, 500) end
  where id = p_id returning * into o;
  if p_ok and nullif(p_external_ref, '') is not null and o.payload ? 'booking' then
    update public.bookings set external_ref = left(p_external_ref, 100) where id = (o.payload->'booking'->>'id')::uuid;
  end if;
end $$;

-- Service-role wrappers (webhook, runner, dispatcher)
create or replace function public.svc_ingest_message(p jsonb) returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.ingest_message(p) $$;
create or replace function public.svc_ingest_echo(p jsonb) returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.ingest_echo(p) $$;
create or replace function public.svc_bot_apply(p_conv uuid, p_version int, p jsonb) returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.bot_apply(p_conv, p_version, p) $$;
create or replace function public.svc_message_result(p_id bigint, p_ok boolean, p_provider_id text, p_error text) returns void language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.message_result(p_id, p_ok, p_provider_id, p_error) $$;
create or replace function public.svc_message_status(p_provider_id text, p_status text) returns void language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.message_status(p_provider_id, p_status) $$;
create or replace function public.svc_ingest_comment(p jsonb) returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.ingest_comment(p) $$;
create or replace function public.svc_comment_result(p_comment uuid, p jsonb) returns void language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.comment_result(p_comment, p) $$;
create or replace function public.svc_comment_conversation(p_comment uuid, p_contact_external_id text, p_state jsonb, p_body text, p_provider_id text) returns uuid language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.comment_conversation(p_comment, p_contact_external_id, p_state, p_body, p_provider_id) $$;
create or replace function public.svc_outbox_claim(p_limit int default 20) returns setof public.integration_outbox language sql volatile security definer set search_path = public, app, pg_temp as $$ select * from app.outbox_claim(p_limit) $$;
create or replace function public.svc_outbox_result(p_id bigint, p_ok boolean, p_error text, p_external_ref text default null) returns void language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.outbox_result(p_id, p_ok, p_error, p_external_ref) $$;

-- ---------------------------------------------------------------------------
-- Staff actions (signed-in session; membership checked inside)
-- ---------------------------------------------------------------------------
create or replace function public.conv_take_over(p_conv uuid)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = p_conv for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  perform app.require_member(c.org_id, array['owner', 'admin', 'agent']);
  update public.conversations set status = 'human', assigned_to = coalesce(assigned_to, auth.uid()), version = version + 1, updated_at = now() where id = c.id;
  insert into public.messages (org_id, conversation_id, direction, author, kind, body, status, agent_id)
  values (c.org_id, c.id, 'out', 'system', 'other', 'تولّى موظف المحادثة / an agent took over', 'sent', auth.uid());
end $$;

create or replace function public.conv_release(p_conv uuid)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = p_conv for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  perform app.require_member(c.org_id, array['owner', 'admin', 'agent']);
  if c.status = 'closed' then raise exception 'conversation is closed' using errcode = '22023'; end if;
  update public.conversations set status = 'bot', needs_attention = false, bot_state = jsonb_build_object('step', 'menu', 'unknown', 0),
    version = version + 1, updated_at = now() where id = c.id;
  insert into public.messages (org_id, conversation_id, direction, author, kind, body, status, agent_id)
  values (c.org_id, c.id, 'out', 'system', 'other', 'أُعيدت المحادثة للمساعد الآلي / handed back to the bot', 'sent', auth.uid());
end $$;

create or replace function public.conv_close(p_conv uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = p_conv for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  perform app.require_member(c.org_id, array['owner', 'admin', 'agent']);
  if length(coalesce(trim(p_reason), '')) < 2 then raise exception 'reason is required' using errcode = '22023'; end if;
  update public.conversations set status = 'closed', needs_attention = false, closed_at = now(), version = version + 1, updated_at = now() where id = c.id;
  insert into public.messages (org_id, conversation_id, direction, author, kind, body, status, agent_id)
  values (c.org_id, c.id, 'out', 'system', 'other', 'أُغلقت: ' || left(trim(p_reason), 300), 'sent', auth.uid());
end $$;

-- An agent reply: logged here (the conversation moves to the agent; the bot stays quiet), then sent by the server.
-- Free text only inside Meta's 24-hour customer-service window.
create or replace function public.conv_log_reply(p_conv uuid, p_body text)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.conversations; v_id bigint; v text := nullif(trim(p_body), '');
begin
  select * into c from public.conversations where id = p_conv for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  perform app.require_member(c.org_id, array['owner', 'admin', 'agent']);
  if v is null or length(v) > 4096 then raise exception 'write the message' using errcode = '22023'; end if;
  if c.last_inbound_at is null or c.last_inbound_at < now() - interval '24 hours' then
    raise exception '24-hour window closed' using errcode = '22023';
  end if;
  insert into public.messages (org_id, conversation_id, direction, author, kind, body, status, agent_id)
  values (c.org_id, c.id, 'out', 'agent', 'text', v, 'queued', auth.uid()) returning id into v_id;
  update public.conversations set status = 'human', needs_attention = false, assigned_to = coalesce(assigned_to, auth.uid()),
    first_human_reply_at = coalesce(first_human_reply_at, now()), last_outbound_at = now(), version = version + 1, updated_at = now()
  where id = c.id;
  return jsonb_build_object('message_id', v_id, 'channel_id', c.channel_id, 'contact_id', c.contact_id);
end $$;

-- Comment moderation by a person: done / ignore / hide / unhide (the server applies hide on Meta first).
create or replace function public.comment_mark(p_comment uuid, p_action text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare cm public.comments;
begin
  select * into cm from public.comments where id = p_comment for update;
  if not found then raise exception 'comment not found' using errcode = 'P0002'; end if;
  perform app.require_member(cm.org_id, array['owner', 'admin', 'agent']);
  if p_action not in ('done', 'ignored', 'hidden', 'unhidden', 'replied') then raise exception 'invalid action' using errcode = '22023'; end if;
  perform app.comment_result(cm.id, jsonb_build_object(
    'status', case when p_action in ('done', 'ignored') then p_action when p_action in ('hidden', 'replied') then 'done' end,
    'hidden', case p_action when 'hidden' then true when 'unhidden' then false end, 'action', p_action));
end $$;

create or replace function public.set_duty(p_org uuid, p_on boolean)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_member(p_org, array['owner', 'admin', 'agent']);
  update public.org_members set on_duty = p_on where org_id = p_org and user_id = auth.uid();
end $$;

-- Owner / admin: bot settings
create or replace function public.save_bot_settings(p_org uuid, p jsonb)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_member(p_org, array['owner', 'admin']);
  update public.bot_settings set
    enabled = coalesce((p->>'enabled')::boolean, enabled), ai_enabled = coalesce((p->>'ai_enabled')::boolean, ai_enabled),
    greeting_ar = coalesce(nullif(p->>'greeting_ar', ''), greeting_ar), greeting_en = coalesce(nullif(p->>'greeting_en', ''), greeting_en),
    handoff_ar = coalesce(nullif(p->>'handoff_ar', ''), handoff_ar), handoff_en = coalesce(nullif(p->>'handoff_en', ''), handoff_en),
    ask_phone = coalesce((p->>'ask_phone')::boolean, ask_phone),
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
end $$;

-- Reports (members). Period in the org's time zone.
create or replace function public.org_report(p_org uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare tz text; r jsonb;
begin
  perform app.require_member(p_org);
  select timezone into tz from public.orgs where id = p_org;
  with cv as (select * from public.conversations where org_id = p_org and created_at >= (p_from::timestamp at time zone tz) and created_at < ((p_to + 1)::timestamp at time zone tz)),
       cm as (select * from public.comments where org_id = p_org and received_at >= (p_from::timestamp at time zone tz) and received_at < ((p_to + 1)::timestamp at time zone tz))
  select jsonb_build_object(
    'conversations', (select count(*) from cv),
    'by_channel', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select ch.kind, count(*) n from cv join public.channels ch on ch.id = cv.channel_id group by ch.kind) x),
    'bookings', (select count(*) from cv where booked_at is not null),
    'booked_by_bot', (select count(*) from cv where booked_at is not null and (handoff_at is null or handoff_at > booked_at)),
    'handoffs', (select count(*) from cv where handoff_at is not null),
    'handoff_reasons', (select coalesce(jsonb_object_agg(coalesce(handoff_reason, '—'), n), '{}') from (select handoff_reason, count(*) n from cv where handoff_at is not null group by 1) x),
    'waiting_now', (select count(*) from public.conversations where org_id = p_org and needs_attention and status = 'human'),
    'avg_human_reply_seconds', (select round(avg(extract(epoch from first_human_reply_at - handoff_at))) from cv where first_human_reply_at is not null and handoff_at is not null and first_human_reply_at >= handoff_at),
    'by_service', (select coalesce(jsonb_object_agg(code, n), '{}') from (select s.code, count(*) n from cv join public.services s on s.id = cv.service_id group by s.code) x),
    'comments', (select count(*) from cm),
    'comments_by_class', (select coalesce(jsonb_object_agg(coalesce(classification, 'new'), n), '{}') from (select classification, count(*) n from cm group by 1) x),
    'comments_auto', (select count(*) from cm where status = 'auto_handled'),
    'comments_need_human', (select count(*) from public.comments where org_id = p_org and status = 'needs_human'),
    'comments_hidden', (select count(*) from cm where hidden_at is not null),
    'comment_dms', (select count(*) from cm where private_reply_at is not null)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.orgs enable row level security;
alter table public.profiles enable row level security;
alter table public.org_members enable row level security;
alter table public.audit_log enable row level security;
alter table public.channels enable row level security;
alter table public.channel_secrets enable row level security;
alter table public.services enable row level security;
alter table public.faqs enable row level security;
alter table public.bot_settings enable row level security;
alter table public.org_secrets enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_identities enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.bookings enable row level security;
alter table public.comments enable row level security;
alter table public.integration_outbox enable row level security;

revoke all on all tables in schema public from anon;
revoke all on public.channel_secrets, public.org_secrets, public.integration_outbox from authenticated;

grant select on public.orgs, public.org_members, public.channels, public.contacts, public.contact_identities,
  public.conversations, public.messages, public.bookings, public.comments, public.audit_log to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.services, public.faqs to authenticated;
grant select on public.bot_settings to authenticated;
grant insert, update on public.orgs, public.org_members, public.channels to authenticated;

create policy orgs_read on public.orgs for select to authenticated using (app.is_member(id));
create policy orgs_write on public.orgs for insert to authenticated with check (app.is_platform_admin());
create policy orgs_update on public.orgs for update to authenticated using (app.is_member(id, array['owner'])) with check (app.is_member(id, array['owner']));
create policy profiles_read on public.profiles for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.org_members m where m.user_id = profiles.user_id and app.is_member(m.org_id)));
create policy profiles_self on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and is_platform_admin = (select p.is_platform_admin from public.profiles p where p.user_id = auth.uid()));
create policy members_read on public.org_members for select to authenticated using (app.is_member(org_id));
create policy members_write on public.org_members for insert to authenticated with check (app.is_member(org_id, array['owner', 'admin']) and (role <> 'owner' or app.is_member(org_id, array['owner'])));
create policy members_update on public.org_members for update to authenticated using (app.is_member(org_id, array['owner', 'admin'])) with check (app.is_member(org_id, array['owner', 'admin']) and (role <> 'owner' or app.is_member(org_id, array['owner'])));
create policy audit_read on public.audit_log for select to authenticated using (org_id is not null and app.is_member(org_id, array['owner', 'admin']));
create policy channels_read on public.channels for select to authenticated using (app.is_member(org_id));
create policy channels_write on public.channels for insert to authenticated with check (app.is_platform_admin());
create policy channels_update on public.channels for update to authenticated using (app.is_member(org_id, array['owner', 'admin'])) with check (app.is_member(org_id, array['owner', 'admin']));
create policy services_read on public.services for select to authenticated using (app.is_member(org_id));
create policy services_insert on public.services for insert to authenticated with check (app.is_member(org_id, array['owner', 'admin']));
create policy services_update on public.services for update to authenticated using (app.is_member(org_id, array['owner', 'admin'])) with check (app.is_member(org_id, array['owner', 'admin']));
create policy faqs_read on public.faqs for select to authenticated using (app.is_member(org_id));
create policy faqs_insert on public.faqs for insert to authenticated with check (app.is_member(org_id, array['owner', 'admin']));
create policy faqs_update on public.faqs for update to authenticated using (app.is_member(org_id, array['owner', 'admin'])) with check (app.is_member(org_id, array['owner', 'admin']));
create policy bot_settings_read on public.bot_settings for select to authenticated using (app.is_member(org_id));
create policy contacts_read on public.contacts for select to authenticated using (app.is_member(org_id));
create policy identities_read on public.contact_identities for select to authenticated using (app.is_member(org_id));
create policy conversations_read on public.conversations for select to authenticated using (app.is_member(org_id));
create policy messages_read on public.messages for select to authenticated using (app.is_member(org_id));
create policy bookings_read on public.bookings for select to authenticated using (app.is_member(org_id));
create policy comments_read on public.comments for select to authenticated using (app.is_member(org_id));

-- Service-role-only functions
revoke execute on all functions in schema public from public, anon;
revoke execute on function public.svc_ingest_message(jsonb), public.svc_ingest_echo(jsonb), public.svc_bot_apply(uuid, int, jsonb),
  public.svc_message_result(bigint, boolean, text, text), public.svc_message_status(text, text), public.svc_ingest_comment(jsonb),
  public.svc_comment_result(uuid, jsonb), public.svc_comment_conversation(uuid, text, jsonb, text, text), public.svc_outbox_claim(int),
  public.svc_outbox_result(bigint, boolean, text, text) from authenticated;
grant execute on function public.svc_ingest_message(jsonb), public.svc_ingest_echo(jsonb), public.svc_bot_apply(uuid, int, jsonb),
  public.svc_message_result(bigint, boolean, text, text), public.svc_message_status(text, text), public.svc_ingest_comment(jsonb),
  public.svc_comment_result(uuid, jsonb), public.svc_comment_conversation(uuid, text, jsonb, text, text), public.svc_outbox_claim(int),
  public.svc_outbox_result(bigint, boolean, text, text) to service_role;
grant execute on function public.conv_take_over(uuid), public.conv_release(uuid), public.conv_close(uuid, text), public.conv_log_reply(uuid, text),
  public.comment_mark(uuid, text), public.set_duty(uuid, boolean), public.save_bot_settings(uuid, jsonb), public.org_report(uuid, date, date) to authenticated;
revoke execute on all functions in schema app from public, anon;
grant execute on function app.is_member(uuid, text[]), app.is_platform_admin(), app.require_member(uuid, text[]), app.normalize_phone(text) to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
