-- Test mode and staff numbers.
--   test_numbers  while not empty, the bot answers ONLY these numbers (and leaves comments to people) — for a safe go-live
--   staff_numbers the bot never answers these (doctors and staff who message the clinic number)
-- Numbers are stored normalized (+20…).
alter table public.bot_settings
  add column test_numbers  text[] not null default '{}',
  add column staff_numbers text[] not null default '{}';

create or replace function public.save_bot_numbers(p_org uuid, p_test text[], p_staff text[])
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare bad text; t text[]; s text[];
begin
  perform app.require_member(p_org, array['owner', 'admin']);
  select x into bad from unnest(coalesce(p_test, '{}') || coalesce(p_staff, '{}')) x
    where nullif(trim(x), '') is not null and app.normalize_phone(x) is null limit 1;
  if bad is not null then raise exception 'invalid phone number: %', left(bad, 40) using errcode = '22023'; end if;
  t := coalesce((select array_agg(distinct app.normalize_phone(x)) from unnest(coalesce(p_test, '{}')) x where nullif(trim(x), '') is not null), '{}');
  s := coalesce((select array_agg(distinct app.normalize_phone(x)) from unnest(coalesce(p_staff, '{}')) x where nullif(trim(x), '') is not null), '{}');
  if cardinality(t) > 50 or cardinality(s) > 200 then raise exception 'too many numbers' using errcode = '22023'; end if;
  update public.bot_settings set test_numbers = t, staff_numbers = s, updated_by = auth.uid(), updated_at = now() where org_id = p_org;
  return jsonb_build_object('test_numbers', to_jsonb(t), 'staff_numbers', to_jsonb(s));
end $$;
revoke execute on function public.save_bot_numbers(uuid, text[], text[]) from public, anon;
grant execute on function public.save_bot_numbers(uuid, text[], text[]) to authenticated;
