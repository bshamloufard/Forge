create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  onboarding_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, avatar_url, onboarding_seen_at, updated_at)
  on table public.profiles to authenticated;

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    ),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now();

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data
on auth.users
for each row
execute function private.handle_new_user();

insert into public.profiles (id, email, full_name, avatar_url)
select
  id,
  coalesce(email, ''),
  coalesce(
    nullif(raw_user_meta_data ->> 'full_name', ''),
    nullif(raw_user_meta_data ->> 'name', '')
  ),
  nullif(raw_user_meta_data ->> 'avatar_url', '')
from auth.users
on conflict (id) do nothing;

create table if not exists private.user_provider_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  modal_token_id_secret_id uuid,
  modal_token_secret_secret_id uuid,
  baseten_api_key_secret_id uuid,
  modal_app_name text not null default 'forge-mvp',
  modal_environment text not null default 'main',
  baseten_base_url text not null default 'https://inference.baseten.co/v1',
  baseten_model_id text not null default 'zai-org/GLM-5.2-Fast',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint modal_credentials_are_a_pair check (
    (modal_token_id_secret_id is null and modal_token_secret_secret_id is null)
    or
    (modal_token_id_secret_id is not null and modal_token_secret_secret_id is not null)
  )
);

revoke all on table private.user_provider_credentials from public, anon, authenticated;

create or replace function private.upsert_vault_secret(
  p_existing_secret_id uuid,
  p_secret_value text,
  p_secret_name text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid := p_existing_secret_id;
begin
  if p_secret_value is null or btrim(p_secret_value) = '' then
    return v_secret_id;
  end if;

  if octet_length(p_secret_value) > 16384 then
    raise exception 'Provider credential is too large'
      using errcode = '22001';
  end if;

  if v_secret_id is null or not exists (
    select 1 from vault.secrets where id = v_secret_id
  ) then
    select id
    into v_secret_id
    from vault.secrets
    where name = p_secret_name;
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      btrim(p_secret_value),
      p_secret_name,
      p_description
    );
  else
    perform vault.update_secret(
      v_secret_id,
      btrim(p_secret_value),
      p_secret_name,
      p_description
    );
  end if;

  return v_secret_id;
end;
$$;

revoke all on function private.upsert_vault_secret(uuid, text, text, text)
  from public, anon, authenticated;

create or replace function private.delete_provider_vault_secrets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets
  where id in (
    old.modal_token_id_secret_id,
    old.modal_token_secret_secret_id,
    old.baseten_api_key_secret_id
  );

  return old;
end;
$$;

revoke all on function private.delete_provider_vault_secrets()
  from public, anon, authenticated;

drop trigger if exists delete_user_provider_vault_secrets
  on private.user_provider_credentials;
create trigger delete_user_provider_vault_secrets
after delete
on private.user_provider_credentials
for each row
execute function private.delete_provider_vault_secrets();

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
    true,
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

create or replace function public.complete_provider_onboarding()
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_seen_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  update public.profiles
  set
    onboarding_seen_at = coalesce(onboarding_seen_at, now()),
    updated_at = now()
  where id = v_user_id
  returning onboarding_seen_at into v_seen_at;

  if v_seen_at is null then
    raise exception 'Profile not found'
      using errcode = 'P0002';
  end if;

  return v_seen_at;
end;
$$;

revoke all on function public.complete_provider_onboarding()
  from public, anon;
grant execute on function public.complete_provider_onboarding()
  to authenticated, service_role;

create or replace function public.save_provider_credentials(
  p_modal_token_id text default null,
  p_modal_token_secret text default null,
  p_baseten_api_key text default null,
  p_modal_app_name text default null,
  p_modal_environment text default null,
  p_baseten_base_url text default null,
  p_baseten_model_id text default null
)
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
  v_modal_token_id uuid;
  v_modal_token_secret uuid;
  v_baseten_api_key uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if (
    nullif(btrim(p_modal_token_id), '') is null
  ) <> (
    nullif(btrim(p_modal_token_secret), '') is null
  ) then
    raise exception 'Modal token ID and token secret must be replaced together'
      using errcode = '22023';
  end if;

  if length(coalesce(p_modal_app_name, '')) > 255
    or length(coalesce(p_modal_environment, '')) > 255
    or length(coalesce(p_baseten_base_url, '')) > 2048
    or length(coalesce(p_baseten_model_id, '')) > 512
  then
    raise exception 'Provider configuration is too large'
      using errcode = '22001';
  end if;

  insert into private.user_provider_credentials (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select
    modal_token_id_secret_id,
    modal_token_secret_secret_id,
    baseten_api_key_secret_id
  into
    v_modal_token_id,
    v_modal_token_secret,
    v_baseten_api_key
  from private.user_provider_credentials
  where user_id = v_user_id
  for update;

  v_modal_token_id := private.upsert_vault_secret(
    v_modal_token_id,
    nullif(btrim(p_modal_token_id), ''),
    'forge:' || v_user_id::text || ':modal-token-id',
    'Forge user Modal token ID'
  );
  v_modal_token_secret := private.upsert_vault_secret(
    v_modal_token_secret,
    nullif(btrim(p_modal_token_secret), ''),
    'forge:' || v_user_id::text || ':modal-token-secret',
    'Forge user Modal token secret'
  );
  v_baseten_api_key := private.upsert_vault_secret(
    v_baseten_api_key,
    nullif(btrim(p_baseten_api_key), ''),
    'forge:' || v_user_id::text || ':baseten-api-key',
    'Forge user Baseten API key'
  );

  update private.user_provider_credentials
  set
    modal_token_id_secret_id = v_modal_token_id,
    modal_token_secret_secret_id = v_modal_token_secret,
    baseten_api_key_secret_id = v_baseten_api_key,
    modal_app_name = coalesce(
      nullif(btrim(p_modal_app_name), ''),
      modal_app_name
    ),
    modal_environment = coalesce(
      nullif(btrim(p_modal_environment), ''),
      modal_environment
    ),
    baseten_base_url = coalesce(
      nullif(btrim(p_baseten_base_url), ''),
      baseten_base_url
    ),
    baseten_model_id = coalesce(
      nullif(btrim(p_baseten_model_id), ''),
      baseten_model_id
    ),
    updated_at = now()
  where user_id = v_user_id;

  update public.profiles
  set
    onboarding_seen_at = coalesce(onboarding_seen_at, now()),
    updated_at = now()
  where id = v_user_id;

  return query
  select
    c.modal_token_id_secret_id is not null
      and c.modal_token_secret_secret_id is not null,
    c.baseten_api_key_secret_id is not null,
    true,
    c.updated_at
  from private.user_provider_credentials as c
  where c.user_id = v_user_id;
end;
$$;

revoke all on function public.save_provider_credentials(
  text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.save_provider_credentials(
  text, text, text, text, text, text, text
) to authenticated, service_role;

create or replace function public.get_provider_credentials_for_service(
  p_user_id uuid
)
returns table (
  modal_token_id text,
  modal_token_secret text,
  modal_app_name text,
  modal_environment text,
  baseten_api_key text,
  baseten_base_url text,
  baseten_model_id text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    modal_id.decrypted_secret,
    modal_secret.decrypted_secret,
    c.modal_app_name,
    c.modal_environment,
    baseten_key.decrypted_secret,
    c.baseten_base_url,
    c.baseten_model_id
  from private.user_provider_credentials as c
  left join vault.decrypted_secrets as modal_id
    on modal_id.id = c.modal_token_id_secret_id
  left join vault.decrypted_secrets as modal_secret
    on modal_secret.id = c.modal_token_secret_secret_id
  left join vault.decrypted_secrets as baseten_key
    on baseten_key.id = c.baseten_api_key_secret_id
  where c.user_id = p_user_id;
$$;

revoke all on function public.get_provider_credentials_for_service(uuid)
  from public, anon, authenticated;
grant execute on function public.get_provider_credentials_for_service(uuid)
  to service_role;

create or replace function public.bootstrap_provider_credentials_for_service(
  p_user_id uuid,
  p_modal_token_id text,
  p_modal_token_secret text,
  p_baseten_api_key text,
  p_modal_app_name text,
  p_modal_environment text,
  p_baseten_base_url text,
  p_baseten_model_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modal_token_id uuid;
  v_modal_token_secret uuid;
  v_baseten_api_key uuid;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id
  ) then
    raise exception 'User not found'
      using errcode = 'P0002';
  end if;

  if nullif(btrim(p_modal_token_id), '') is null
    or nullif(btrim(p_modal_token_secret), '') is null
    or nullif(btrim(p_baseten_api_key), '') is null
  then
    raise exception 'Founder provider credentials are incomplete'
      using errcode = '22023';
  end if;

  insert into private.user_provider_credentials (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select
    modal_token_id_secret_id,
    modal_token_secret_secret_id,
    baseten_api_key_secret_id
  into
    v_modal_token_id,
    v_modal_token_secret,
    v_baseten_api_key
  from private.user_provider_credentials
  where user_id = p_user_id
  for update;

  v_modal_token_id := private.upsert_vault_secret(
    v_modal_token_id,
    p_modal_token_id,
    'forge:' || p_user_id::text || ':modal-token-id',
    'Forge user Modal token ID'
  );
  v_modal_token_secret := private.upsert_vault_secret(
    v_modal_token_secret,
    p_modal_token_secret,
    'forge:' || p_user_id::text || ':modal-token-secret',
    'Forge user Modal token secret'
  );
  v_baseten_api_key := private.upsert_vault_secret(
    v_baseten_api_key,
    p_baseten_api_key,
    'forge:' || p_user_id::text || ':baseten-api-key',
    'Forge user Baseten API key'
  );

  update private.user_provider_credentials
  set
    modal_token_id_secret_id = v_modal_token_id,
    modal_token_secret_secret_id = v_modal_token_secret,
    baseten_api_key_secret_id = v_baseten_api_key,
    modal_app_name = coalesce(
      nullif(btrim(p_modal_app_name), ''),
      modal_app_name
    ),
    modal_environment = coalesce(
      nullif(btrim(p_modal_environment), ''),
      modal_environment
    ),
    baseten_base_url = coalesce(
      nullif(btrim(p_baseten_base_url), ''),
      baseten_base_url
    ),
    baseten_model_id = coalesce(
      nullif(btrim(p_baseten_model_id), ''),
      baseten_model_id
    ),
    updated_at = now()
  where user_id = p_user_id;

  update public.profiles
  set
    onboarding_seen_at = coalesce(onboarding_seen_at, now()),
    updated_at = now()
  where id = p_user_id;
end;
$$;

revoke all on function public.bootstrap_provider_credentials_for_service(
  uuid, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.bootstrap_provider_credentials_for_service(
  uuid, text, text, text, text, text, text, text
) to service_role;

-- The product API is server-mediated. Remove the previous MVP-wide read access
-- so signing in never grants visibility into another account's control-plane data.
drop policy if exists "authenticated read organizations" on public.organizations;
drop policy if exists "authenticated read projects" on public.projects;
drop policy if exists "authenticated read sessions" on public.sessions;
drop policy if exists "authenticated read runs" on public.runs;
drop policy if exists "authenticated read run events" on public.run_events;
drop policy if exists "authenticated read checkpoints" on public.checkpoints;
drop policy if exists "authenticated read verifier jobs" on public.verifier_jobs;
drop policy if exists "authenticated read deployments" on public.deployments;

revoke all on table public.organizations from anon, authenticated;
revoke all on table public.projects from anon, authenticated;
revoke all on table public.sessions from anon, authenticated;
revoke all on table public.runs from anon, authenticated;
revoke all on table public.run_events from anon, authenticated;
revoke all on table public.checkpoints from anon, authenticated;
revoke all on table public.verifier_jobs from anon, authenticated;
revoke all on table public.deployments from anon, authenticated;
