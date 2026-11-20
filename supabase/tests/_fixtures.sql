-- Test fixtures (synthetic only): two client orgs, staff, channels, services.
create schema if not exists test;
grant usage on schema test to authenticated, anon;
create or replace function test.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function test.expect_error(p_sql text, p_expect text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(lower(p_expect) in lower(sqlerrm)) = 0 then raise exception 'ASSERTION FAILED: expected error containing "%", got "%"', p_expect, sqlerrm; end if;
    return;
  end;
  raise exception 'ASSERTION FAILED: expected error "%" but statement succeeded: %', p_expect, p_sql;
end $$;
create or replace function test.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false)
$$;
grant execute on all functions in schema test to authenticated, anon;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'platform@echowave.test'),
  ('00000000-0000-4000-8000-0000000000b1', 'owner@gc.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'agent1@gc.test'),
  ('00000000-0000-4000-8000-0000000000b3', 'agent2@gc.test'),
  ('00000000-0000-4000-8000-0000000000b4', 'viewer@gc.test'),
  ('00000000-0000-4000-8000-0000000000c1', 'agent@other.test'),
  ('00000000-0000-4000-8000-0000000000d1', 'nobody@x.test');
insert into public.profiles (user_id, full_name, is_platform_admin) values
  ('00000000-0000-4000-8000-0000000000a1', 'EchoWave Admin', true),
  ('00000000-0000-4000-8000-0000000000b1', 'مالك العيادة', false),
  ('00000000-0000-4000-8000-0000000000b2', 'أحمد', false),
  ('00000000-0000-4000-8000-0000000000b3', 'منة', false),
  ('00000000-0000-4000-8000-0000000000b4', 'مشاهد', false),
  ('00000000-0000-4000-8000-0000000000c1', 'Other Agent', false),
  ('00000000-0000-4000-8000-0000000000d1', 'Nobody', false);
insert into public.orgs (id, slug, name) values
  ('00000000-0000-4000-8000-00000000000a', 'golden-care', 'Golden Care Clinics'),
  ('00000000-0000-4000-8000-00000000000b', 'other-clinic', 'Other Clinic');
insert into public.org_members (org_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000b1', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000b2', 'agent'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000b3', 'agent'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000b4', 'viewer'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000c1', 'agent');
insert into public.channels (id, org_id, kind, external_id, name) values
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000000a', 'whatsapp', 'PN-GC', 'Golden Care WhatsApp'),
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-00000000000a', 'messenger', 'PAGE-GC', 'Golden Care page'),
  ('00000000-0000-4000-8000-0000000c0003', '00000000-0000-4000-8000-00000000000a', 'instagram', 'IG-GC', 'Golden Care Instagram'),
  ('00000000-0000-4000-8000-0000000c0004', '00000000-0000-4000-8000-00000000000b', 'messenger', 'PAGE-OTHER', 'Other page');
insert into public.channel_secrets (channel_id, access_token) values ('00000000-0000-4000-8000-0000000c0001', 'secret-token');
insert into public.services (org_id, code, name_ar, name_en, summary_ar, summary_en, offer_ar, keywords, campaign_codes, sort) values
  ('00000000-0000-4000-8000-00000000000a', 'laser', 'إزالة الشعر بالليزر', 'Laser hair removal', 'جلسات ليزر بأحدث الأجهزة.', 'Laser sessions.', 'خصم الجمعة الذهبية', array['ليزر', 'laser'], array['gf26-laser'], 1),
  ('00000000-0000-4000-8000-00000000000a', 'DENTAL', 'الأسنان', 'Dental', 'تنظيف وتبييض وتقويم.', 'Cleaning, whitening, braces.', null, array['اسنان', 'تبييض'], array['GF26-DENTAL'], 2);
update public.bot_settings set integration_url = 'https://golden-care.test/api/integrations/engage' where org_id = '00000000-0000-4000-8000-00000000000a';
