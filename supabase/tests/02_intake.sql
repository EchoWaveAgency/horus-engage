-- 02 — intake flow: placeholders never go live, short ad codes, filter options, FAQ handoff modes, settings, intake handoff
\set gc      '00000000-0000-4000-8000-00000000000a'
\set owner   '00000000-0000-4000-8000-0000000000b1'
\set ag1     '00000000-0000-4000-8000-0000000000b2'

-- ---------- services: short ad codes kept; filter options cleaned; placeholders refused while active
insert into public.services (org_id, code, name_ar, name_en, summary_ar, summary_en, campaign_codes, filter_question_ar, filter_options)
values (:'gc', 'dental-x', 'الأسنان', 'Dental', 'الأسنان', 'Dental', array['d1', 'x'], '  تمام. إيه الأقرب لحالتك؟ ',
        '[{"ar": " تقويم ", "en": ""}, {"ar": "", "en": "empty"}, {"ar": "زراعة", "en": "Implants"}]');
select test.assert((select code = 'DENTAL-X' and campaign_codes = array['D1'] and filter_question_ar = 'تمام. إيه الأقرب لحالتك؟'
  and filter_options = '[{"ar": "تقويم", "en": "تقويم"}, {"ar": "زراعة", "en": "Implants"}]'::jsonb
  from public.services where org_id = :'gc' and code = 'DENTAL-X'), 'two-character ad code kept, one-character dropped; options trimmed, empty dropped, English falls back');

select test.expect_error($$update public.services set price_ar = 'سعر الكشف [المبلغ] جنيه' where code = 'DENTAL-X'$$, 'services_placeholder_check');
select test.expect_error($$update public.services set filter_options = '[{"ar": "[اختيار]", "en": "x"}]' where code = 'DENTAL-X'$$, 'services_placeholder_check');
update public.services set price_ar = 'سعر الكشف [المبلغ] جنيه', is_active = false where code = 'DENTAL-X';
select test.assert((select not is_active from public.services where code = 'DENTAL-X'), 'an unfilled service can be saved switched off');
update public.services set price_ar = null, is_active = true where code = 'DENTAL-X';
select test.assert((select count(*) = 0 from public.services where filter_options::text like '%"en": ""%'), 'no empty option labels');

-- ---------- FAQs: handoff modes; placeholders only while off
insert into public.faqs (org_id, question_ar, question_en, answer_ar, answer_en, keywords, handoff)
values (:'gc', 'ينفع أحجز النهارده؟', 'Today?', 'هنشوف أقرب ميعاد متاح.', 'We will look.', array['النهارده'], 'yes');
select test.expect_error($$insert into public.faqs (org_id, question_ar, question_en, answer_ar, answer_en, keywords)
  values ('00000000-0000-4000-8000-00000000000a', 'فيه ركنة؟', 'Parking?', '[معلومة الركن]', 'x', array['ركنه'])$$, 'faqs_placeholder_check');
insert into public.faqs (org_id, question_ar, question_en, answer_ar, answer_en, keywords, is_active)
values (:'gc', 'فيه ركنة؟', 'Parking?', '[معلومة الركن]', '[parking]', array['ركنه'], false);
select test.expect_error($$update public.faqs set is_active = true where question_ar = 'فيه ركنة؟'$$, 'faqs_placeholder_check');
select test.expect_error($$update public.faqs set handoff = 'maybe' where question_ar = 'فيه ركنة؟'$$, 'faqs_handoff_check');
select test.assert((select handoff = 'no' from public.faqs where question_ar = 'فيه ركنة؟'), 'default handoff: the bot carries on');

-- ---------- settings: owner switches Golden Care to the intake flow
set role authenticated;
select test.login(:'owner');
select public.save_bot_settings(:'gc', jsonb_build_object('booking_flow', 'intake', 'intake_visit_ar', 'ده أول كشف ليك عندنا ولا متابعة؟',
  'intake_done_ar', 'شكراً يا {name}.', 'emergency_ar', 'اتوجّه لأقرب طوارئ فوراً.', 'medical_ar', '  '));
select test.assert((select booking_flow = 'intake' and intake_visit_ar like 'ده أول كشف%' and intake_done_ar = 'شكراً يا {name}.' and medical_ar is null
  from public.bot_settings where org_id = :'gc'), 'intake flow saved; blank text = engine default');
select test.expect_error($$select public.save_bot_settings('00000000-0000-4000-8000-00000000000a', '{"booking_flow": "calendar"}')$$, 'invalid booking flow');
select test.expect_error($$select public.save_bot_settings('00000000-0000-4000-8000-00000000000a', '{"intake_done_ar": "شكراً، هنكلمك [الساعة]"}')$$, 'placeholder');
select test.assert((select intake_done_ar = 'شكراً يا {name}.' from public.bot_settings where org_id = :'gc'), 'refused save changed nothing');
select test.login(:'ag1');
select test.expect_error($$select public.save_bot_settings('00000000-0000-4000-8000-00000000000a', '{"booking_flow": "slots"}')$$, 'permission');
reset role;
select test.login(null);

-- ---------- end of the intake: name saved, booking request (period only), waiting for a person
select public.svc_ingest_message(jsonb_build_object('channel_kind', 'whatsapp', 'channel_external_id', 'PN-GC', 'contact_external_id', '201005556677',
  'name', '🌸', 'text', 'D1', 'provider_id', 'wamid.intake.1')) as i1 \gset
select (:'i1'::jsonb)->>'conversation_id' as ic \gset
select public.svc_bot_apply(:'ic', ((:'i1'::jsonb)->>'version')::int, jsonb_build_object(
  'state', jsonb_build_object('step', 'done', 'service', 'DENTAL-X'), 'status', 'human', 'handoff_reason', 'intake_done',
  'service_code', 'DENTAL-X', 'campaign_code', 'D1', 'contact', jsonb_build_object('name', 'مني أحمد', 'lang', 'ar'),
  'booking', jsonb_build_object('day', null, 'period', 'evening', 'note', 'DENTAL-X · تقويم · أول مرة · بالليل · مني أحمد · D1'),
  'messages', jsonb_build_array(jsonb_build_object('body', 'شكراً يا مني أحمد.')))) is not null as x \gset
select test.assert((select status = 'human' and needs_attention and handoff_reason = 'intake_done' and campaign_code = 'D1' and booked_at is not null
  from public.conversations where id = :'ic'), 'intake done: waiting for a person, booking time recorded');
select test.assert((select name = 'مني أحمد' from public.contacts c join public.conversations v on v.contact_id = c.id where v.id = :'ic'), 'the name the patient gave replaces the profile name');
select test.assert((select preferred_day is null and preferred_period = 'evening' and note like '%تقويم%' from public.bookings where conversation_id = :'ic'), 'booking request: period, no day, intake answers in the note');
select test.assert((select count(*) = 1 from public.integration_outbox where event = 'booking_request' and payload->>'conversation_id' = :'ic'), 'call-center system gets the booking request');
