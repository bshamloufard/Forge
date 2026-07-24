create or replace function public.claim_provider_onboarding()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated_rows integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  update public.profiles
  set
    onboarding_seen_at = now(),
    updated_at = now()
  where id = v_user_id
    and onboarding_seen_at is null;

  get diagnostics v_updated_rows = row_count;
  return v_updated_rows = 1;
end;
$$;

revoke all on function public.claim_provider_onboarding()
  from public, anon;
grant execute on function public.claim_provider_onboarding()
  to authenticated, service_role;
