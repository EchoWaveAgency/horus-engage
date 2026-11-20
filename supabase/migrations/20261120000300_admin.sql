-- HORUS Engage — 0003 owner tools: integration secret (to configure the client's system), rotate it.
create or replace function public.org_integration_secret(p_org uuid)
returns text language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_member(p_org, array['owner']);
  return (select integration_secret from public.org_secrets where org_id = p_org);
end $$;
create or replace function public.rotate_integration_secret(p_org uuid)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v text := encode(gen_random_bytes(24), 'hex');
begin
  perform app.require_member(p_org, array['owner']);
  update public.org_secrets set integration_secret = v, updated_at = now() where org_id = p_org;
  insert into public.audit_log (org_id, action, table_name, record_id) values (p_org, 'ROTATE', 'org_secrets', p_org::text);
  return v;
end $$;
-- Platform admin: store a channel token (never readable by any client role).
create or replace function public.set_channel_token(p_channel uuid, p_token text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_platform_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  if length(coalesce(p_token, '')) < 20 then raise exception 'token looks invalid' using errcode = '22023'; end if;
  insert into public.channel_secrets (channel_id, access_token) values (p_channel, p_token)
  on conflict (channel_id) do update set access_token = excluded.access_token, updated_at = now();
  insert into public.audit_log (org_id, action, table_name, record_id) select org_id, 'TOKEN', 'channel_secrets', id::text from public.channels where id = p_channel;
end $$;
create or replace function public.channel_has_token(p_channel uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_member((select org_id from public.channels where id = p_channel)) and exists (select 1 from public.channel_secrets where channel_id = p_channel)
$$;
revoke execute on function public.org_integration_secret(uuid), public.rotate_integration_secret(uuid), public.set_channel_token(uuid, text), public.channel_has_token(uuid) from public, anon;
grant execute on function public.org_integration_secret(uuid), public.rotate_integration_secret(uuid), public.set_channel_token(uuid, text), public.channel_has_token(uuid) to authenticated;
