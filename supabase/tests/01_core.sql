-- 01 — ingest, bot steps, handoff, bookings, events, comments, staff actions, isolation between clients
\set gc      '00000000-0000-4000-8000-00000000000a'
\set other   '00000000-0000-4000-8000-00000000000b'
\set owner   '00000000-0000-4000-8000-0000000000b1'
\set ag1     '00000000-0000-4000-8000-0000000000b2'
\set viewer  '00000000-0000-4000-8000-0000000000b4'
\set oag     '00000000-0000-4000-8000-0000000000c1'
\set nobody  '00000000-0000-4000-8000-0000000000d1'
\set admin   '00000000-0000-4000-8000-0000000000a1'

select test.assert((select integration_secret is not null and length(integration_secret) = 48 from public.org_secrets where org_id = :'gc'), 'new org gets an integration secret');
select test.assert((select code = 'LASER' and campaign_codes = array['GF26-LASER'] from public.services where org_id = :'gc' and name_en like 'Laser%'), 'codes upper-cased');

-- ---------- WhatsApp message (from an ad) → contact + conversation with the bot
select public.svc_ingest_message(jsonb_build_object('channel_kind', 'whatsapp', 'channel_external_id', 'PN-GC', 'contact_external_id', '201001112233',
  'name', 'Mariam', 'text', 'GF26-LASER عايزة اعرف العرض', 'provider_id', 'wamid.1', 'referral', jsonb_build_object('source_id', '1202', 'source_type', 'ad'))) as r1 \gset
select test.assert((:'r1'::jsonb)->>'action' = 'new_conversation' and (:'r1'::jsonb)->>'status' = 'bot', 'new conversation with the bot');
select ((:'r1'::jsonb)->>'conversation_id')::uuid as c1 \gset
select test.assert((select phone = '+201001112233' and name = 'Mariam' from public.contacts where id = ((:'r1'::jsonb)->'contact'->>'id')::uuid), 'WhatsApp contact has its phone');
select test.assert((select source = 'ad' and referral->>'source_id' = '1202' from public.conversations where id = :'c1'), 'ad referral kept');
select test.assert((public.svc_ingest_message(jsonb_build_object('channel_kind', 'whatsapp', 'channel_external_id', 'PN-GC', 'contact_external_id', '201001112233', 'text', 'x', 'provider_id', 'wamid.1')))->>'action' = 'duplicate', 'Meta retry ignored');
select test.assert((public.svc_ingest_message(jsonb_build_object('channel_kind', 'whatsapp', 'channel_external_id', 'PN-NOPE', 'contact_external_id', '2010', 'text', 'x')))->>'action' = 'unknown_channel', 'unknown channel ignored');

-- ---------- Bot step: answer with buttons; stale version refused; lead event once the phone is known
select public.svc_bot_apply(:'c1', 0, jsonb_build_object('state', jsonb_build_object('step', 'service', 'service', 'LASER'), 'service_code', 'laser', 'campaign_code', 'GF26-LASER',
  'messages', jsonb_build_array(jsonb_build_object('kind', 'buttons', 'body', 'ليزر…', 'payload', jsonb_build_object('buttons', jsonb_build_array(jsonb_build_object('id', 'book', 'title', 'احجز'))))))) as a1 \gset
select test.assert(jsonb_array_length((:'a1'::jsonb)->'message_ids') = 1 and ((:'a1'::jsonb)->>'version')::int = 1, 'bot message queued, version 1');
select test.expect_error(format($q$select public.svc_bot_apply(%L, 0, '{}')$q$, :'c1'), 'conversation changed');
select test.assert((select count(*) = 1 from public.integration_outbox where event = 'lead' and payload->>'conversation_id' = :'c1'), 'lead event queued (phone known)');
select test.assert((select payload->'contact'->>'phone' = '+201001112233' and payload->>'service_code' = 'LASER' and payload->>'campaign_code' = 'GF26-LASER'
                    and jsonb_array_length(payload->'transcript') = 2 from public.integration_outbox where event = 'lead'), 'event payload: contact, service, campaign, transcript');
select public.svc_message_result(((:'a1'::jsonb)->'message_ids'->>0)::bigint, true, 'wamid.out1', null);
select public.svc_message_status('wamid.out1', 'read'); select public.svc_message_status('wamid.out1', 'delivered');
select test.assert((select status = 'read' from public.messages where provider_message_id = 'wamid.out1'), 'delivery status monotonic');

-- ---------- Booking request → event; then handoff
select public.svc_bot_apply(:'c1', 1, jsonb_build_object('state', jsonb_build_object('step', 'done'),
  'booking', jsonb_build_object('day', '2026-11-27', 'period', 'evening', 'note', 'GF26-LASER'),
  'messages', jsonb_build_array(jsonb_build_object('body', 'تم تسجيل طلب الحجز')))) is not null as x \gset
select test.assert((select count(*) = 1 from public.bookings where conversation_id = :'c1' and preferred_period = 'evening'), 'booking request saved');
select test.assert((select count(*) = 1 from public.integration_outbox where event = 'booking_request' and payload->'booking'->>'day' = '2026-11-27'), 'booking event queued');
select public.svc_bot_apply(:'c1', 2, '{"status": "human", "handoff_reason": "asked_human", "messages": [{"body": "هحوّلك لموظف"}]}') is not null as x \gset
select test.assert((select status = 'human' and needs_attention and handoff_reason = 'asked_human' from public.conversations where id = :'c1'), 'handoff: waiting for a person');
select test.expect_error(format($q$select public.svc_bot_apply(%L, 3, '{}')$q$, :'c1'), 'not with the bot');
select test.expect_error(format($q$select public.svc_bot_apply(%L, 3, '{"contact": {"phone": "abc"}}')$q$, :'c1'), 'not with the bot');

-- ---------- Outbox delivery
select id as ob from public.svc_outbox_claim(10) where event = 'booking_request' \gset
select public.svc_outbox_result(:ob, true, null, 'GF26-ABCDEF');
select test.assert((select external_ref = 'GF26-ABCDEF' from public.bookings where conversation_id = :'c1'), 'external reference stored on the booking');
select test.assert((select count(*) = 0 from public.svc_outbox_claim(10) where id = :ob), 'sent event not claimed again');

-- ---------- Messenger: echo from Business Suite silences the bot
select public.svc_ingest_message('{"channel_kind": "messenger", "channel_external_id": "PAGE-GC", "contact_external_id": "PSID-1", "text": "hello", "provider_id": "m_1"}') as r2 \gset
select ((:'r2'::jsonb)->>'conversation_id')::uuid as c2 \gset
select test.assert((select phone is null and lang = 'en' from public.contacts where id = ((:'r2'::jsonb)->'contact'->>'id')::uuid), 'Messenger contact has no phone yet; English detected');
select test.assert((public.svc_ingest_echo('{"channel_kind": "messenger", "channel_external_id": "PAGE-GC", "contact_external_id": "PSID-1", "text": "hi from the page", "provider_id": "m_echo"}'))->>'action' = 'human_took_over', 'echo → human');
select test.assert((select status = 'human' and first_human_reply_at is not null from public.conversations where id = :'c2'), 'bot quiet once a person replies in Meta');
select test.expect_error(format($q$select public.svc_bot_apply(%L, (select version from public.conversations where id = %L), '{"contact": {"phone": "01001234567"}}')$q$, :'c2', :'c2'), 'not with the bot');

-- ---------- Comments
select public.svc_ingest_comment('{"platform": "facebook", "channel_external_id": "PAGE-GC", "comment_id": "c_1", "post_id": "p_1", "author_id": "U1", "author_name": "Sara", "text": "بكام الجلسة؟"}') as k1 \gset
select test.assert((:'k1'::jsonb)->>'action' = 'new', 'comment stored');
select test.assert((public.svc_ingest_comment('{"platform": "facebook", "channel_external_id": "PAGE-GC", "comment_id": "c_1", "text": "x"}'))->>'action' = 'duplicate', 'comment retry ignored');
select test.assert((public.svc_ingest_comment('{"platform": "facebook", "channel_external_id": "PAGE-GC", "comment_id": "c_own", "author_id": "PAGE-GC", "text": "our reply"}'))->>'action' = 'own', 'own replies ignored (no loops)');
select ((:'k1'::jsonb)->>'comment_id')::uuid as k1id \gset
select public.svc_comment_result(:'k1id', '{"classification": "price", "status": "auto_handled", "public_reply": "بعتنالك في الخاص", "public_reply_id": "r_1", "private_reply": true, "action": "public reply + DM"}');
select public.svc_comment_conversation(:'k1id', 'PSID-SARA', '{"step": "menu"}', 'أهلاً سارة…', 'm_priv') as kc \gset
select test.assert((select status = 'auto_handled' and private_reply_at is not null and conversation_id = :'kc' and jsonb_array_length(actions) = 1 from public.comments where id = :'k1id'), 'comment handled, DM conversation linked');
select test.assert((select source = 'comment' and bot_state->>'step' = 'menu' from public.conversations where id = :'kc'), 'DM conversation waits on the menu');

-- ---------- Staff: isolation and permissions
set role authenticated;
select test.login(:'oag');
select test.assert((select count(*) = 0 from public.conversations where org_id = :'gc') and (select count(*) = 0 from public.comments where org_id = :'gc')
                   and (select count(*) = 0 from public.messages where org_id = :'gc') and (select count(*) = 0 from public.contacts where org_id = :'gc'), 'another client sees nothing of Golden Care');
select test.expect_error(format($q$select public.conv_take_over(%L)$q$, :'c1'), 'permission denied');
select test.login(:'nobody');
select test.assert((select count(*) = 0 from public.orgs), 'no membership → nothing');
select test.login(:'ag1');
select test.expect_error($q$select count(*) from public.channel_secrets$q$, 'permission denied');
select test.expect_error($q$select count(*) from public.org_secrets$q$, 'permission denied');
select test.expect_error($q$select count(*) from public.integration_outbox$q$, 'permission denied');
select test.expect_error(format($q$select public.svc_ingest_message('{}')$q$), 'permission denied');
update public.services set price_ar = '100' where org_id = :'gc';
select test.assert((select count(*) = 0 from public.services where price_ar = '100'), 'agent cannot change approved answers (RLS: no rows changed)');
select test.expect_error(format($q$delete from public.conversations where id = %L$q$, :'c1'), 'permission denied');
select test.assert((select count(*) >= 3 from public.conversations where org_id = :'gc'), 'agent sees the clinic inbox');
select public.conv_log_reply(:'c1', 'أهلاً مريم، أنا أحمد من خدمة العملاء') as rep \gset
select test.assert((select status = 'human' and not needs_attention and assigned_to = :'ag1' and first_human_reply_at is not null from public.conversations where id = :'c1'), 'agent reply: owner and first reply time');
select test.assert((select author = 'agent' and status = 'queued' from public.messages where id = ((:'rep'::jsonb)->>'message_id')::bigint), 'reply queued for sending');
select public.conv_release(:'c1');
select test.assert((select status = 'bot' and bot_state->>'step' = 'menu' from public.conversations where id = :'c1'), 'handed back to the bot at the menu');
select public.conv_take_over(:'c1');
select test.expect_error(format($q$select public.conv_close(%L, '')$q$, :'c1'), 'reason is required');
select public.comment_mark(:'k1id', 'done');
select test.expect_error(format($q$select public.comment_mark(%L, 'delete')$q$, :'k1id'), 'invalid action');
select test.expect_error(format($q$select public.save_bot_settings(%L, '{"enabled": false}')$q$, :'gc'), 'permission denied');
select test.login(:'viewer');
select test.expect_error(format($q$select public.conv_take_over(%L)$q$, :'c1'), 'permission denied');
select test.login(:'owner');
update public.services set price_ar = 'من 500 جنيه' where org_id = :'gc' and code = 'LASER';
select test.assert((select price_ar = 'من 500 جنيه' from public.services where org_id = :'gc' and code = 'LASER'), 'owner edits approved answers');
select test.expect_error(format($q$select public.save_bot_settings(%L, '{"integration_url": "ftp://x"}')$q$, :'gc'), 'https://');
select public.save_bot_settings(:'gc', '{"ai_enabled": true, "comment_replies_ar": ["ردينا عليك في الخاص 💬"]}');
select test.assert((select ai_enabled and comment_replies_ar = array['ردينا عليك في الخاص 💬'] from public.bot_settings where org_id = :'gc'), 'settings saved');
select test.expect_error(format($q$insert into public.channels (org_id, kind, external_id, name) values (%L, 'whatsapp', 'X', 'x')$q$, :'gc'), 'row-level security');
select public.org_report(:'gc', current_date - 1, current_date + 1) as rep \gset
select test.assert((:'rep'::jsonb->>'conversations')::int = 3 and (:'rep'::jsonb->>'bookings')::int = 1 and (:'rep'::jsonb->>'handoffs')::int = 1
                   and (:'rep'::jsonb->>'comments')::int = 1 and (:'rep'::jsonb->>'comment_dms')::int = 1 and (:'rep'::jsonb->'by_channel'->>'whatsapp')::int = 1, 'report');
select test.assert((select count(*) >= 1 from public.audit_log where table_name = 'services' and actor_id = :'owner'), 'audit: who changed the answers');
select test.login(:'admin');
insert into public.channels (org_id, kind, external_id, name) values (:'gc', 'whatsapp', 'PN-GC-2', 'Second number');
set role anon;
select test.expect_error($q$select count(*) from public.conversations$q$, 'permission denied');

-- ---------- Owner tools
set role authenticated;
select test.login(:'owner');
select test.assert(length(public.org_integration_secret(:'gc')) = 48, 'owner reads the integration secret');
select public.rotate_integration_secret(:'gc') as s2 \gset
select test.assert(public.org_integration_secret(:'gc') = :'s2', 'rotated');
select test.expect_error(format($q$select public.set_channel_token('00000000-0000-4000-8000-0000000c0002', 'EAAG-long-token-123456789')$q$), 'permission denied');
select test.assert(public.channel_has_token('00000000-0000-4000-8000-0000000c0001') and not public.channel_has_token('00000000-0000-4000-8000-0000000c0002'), 'token presence visible, value not');
select test.login(:'ag1');
select test.expect_error(format($q$select public.org_integration_secret(%L)$q$, :'gc'), 'permission denied');
select test.login(:'admin');
select public.set_channel_token('00000000-0000-4000-8000-0000000c0002', 'EAAG-long-token-123456789');
