revoke update (onboarding_seen_at)
  on table public.profiles
  from authenticated;

alter function public.complete_provider_onboarding()
  security definer;

alter table private.user_provider_credentials
  drop constraint if exists baseten_base_url_is_managed;

alter table private.user_provider_credentials
  add constraint baseten_base_url_is_managed
  check (baseten_base_url = 'https://inference.baseten.co/v1');

create or replace function public.get_provider_setup_status()
returns table (
  modal_configured boolean,
  baseten_configured boolean,
  storage_configured boolean,
  configuration_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  return query
  select
    c.modal_token_id_secret_id is not null
      and c.modal_token_secret_secret_id is not null,
    c.baseten_api_key_secret_id is not null,
    exists (
      select 1
      from storage.buckets
      where id = 'checkpoints'
        and public is false
    ),
    c.updated_at
  from (select v_user_id as user_id) as request_user
  left join private.user_provider_credentials as c
    on c.user_id = request_user.user_id;
end;
$$;

revoke all on function public.get_provider_setup_status()
  from public, anon;
grant execute on function public.get_provider_setup_status()
  to authenticated, service_role;
