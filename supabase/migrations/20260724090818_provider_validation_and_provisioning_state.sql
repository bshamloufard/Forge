-- Persist validated provider state and fence Modal worker provisioning.
alter table private.user_provider_credentials
  add column if not exists modal_config_generation bigint not null default 0,
  add column if not exists baseten_config_generation bigint not null default 0,
  add column if not exists modal_connection_state text not null default 'missing',
  add column if not exists baseten_connection_state text not null default 'missing',
  add column if not exists modal_validated_at timestamptz,
  add column if not exists baseten_validated_at timestamptz,
  add column if not exists modal_worker_state text not null default 'missing',
  add column if not exists modal_worker_revision text,
  add column if not exists modal_worker_error_code text,
  add column if not exists modal_worker_checked_at timestamptz,
  add column if not exists modal_provisioning_started_at timestamptz,
  add column if not exists modal_provisioning_lease_id uuid;

alter table private.user_provider_credentials
  drop constraint if exists modal_config_generation_is_nonnegative,
  drop constraint if exists baseten_config_generation_is_nonnegative,
  drop constraint if exists modal_connection_state_is_valid,
  drop constraint if exists baseten_connection_state_is_valid,
  drop constraint if exists modal_worker_state_is_valid;

alter table private.user_provider_credentials
  add constraint modal_config_generation_is_nonnegative
    check (modal_config_generation >= 0),
  add constraint baseten_config_generation_is_nonnegative
    check (baseten_config_generation >= 0),
  add constraint modal_connection_state_is_valid
    check (modal_connection_state in ('missing', 'valid', 'invalid', 'unavailable')),
  add constraint baseten_connection_state_is_valid
    check (baseten_connection_state in ('missing', 'valid', 'invalid', 'unavailable')),
  add constraint modal_worker_state_is_valid
    check (modal_worker_state in ('missing', 'pending', 'provisioning', 'ready', 'error'));

update private.user_provider_credentials
set
  modal_connection_state = case
    when modal_token_id_secret_id is not null
      and modal_token_secret_secret_id is not null
      then 'unavailable'
    else 'missing'
  end,
  baseten_connection_state = case
    when baseten_api_key_secret_id is not null then 'unavailable'
    else 'missing'
  end,
  modal_worker_state = case
    when modal_token_id_secret_id is not null
      and modal_token_secret_secret_id is not null
      then 'pending'
    else 'missing'
  end,
  modal_validated_at = null,
  baseten_validated_at = null,
  modal_worker_revision = null,
  modal_worker_error_code = null,
  modal_worker_checked_at = null,
  modal_provisioning_started_at = null,
  modal_provisioning_lease_id = null;

-- Browser sessions must not be able to bypass server-side provider
-- validation. Keep the legacy function in place during rolling deploys, but
-- remove every executable grant.
revoke all on function public.save_provider_credentials(
  text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;

drop function if exists public.get_provider_setup_status();

create function public.get_provider_setup_status()
returns table (
  modal_configured boolean,
  baseten_configured boolean,
  storage_configured boolean,
  configuration_updated_at timestamptz,
  modal_credentials_present boolean,
  baseten_credentials_present boolean,
  modal_connection_state text,
  baseten_connection_state text,
  modal_worker_state text,
  modal_worker_revision text,
  modal_validation_checked_at timestamptz,
  baseten_validation_checked_at timestamptz,
  modal_worker_error_code text
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
      and c.modal_token_secret_secret_id is not null
      and c.modal_connection_state = 'valid'
      and c.modal_worker_state = 'ready',
    c.baseten_api_key_secret_id is not null
      and c.baseten_connection_state = 'valid',
    exists (
      select 1
      from storage.buckets
      where id = 'checkpoints'
        and public is false
    ),
    c.updated_at,
    c.modal_token_id_secret_id is not null
      and c.modal_token_secret_secret_id is not null,
    c.baseten_api_key_secret_id is not null,
    coalesce(c.modal_connection_state, 'missing'),
    coalesce(c.baseten_connection_state, 'missing'),
    coalesce(c.modal_worker_state, 'missing'),
    c.modal_worker_revision,
    greatest(c.modal_validated_at, c.modal_worker_checked_at),
    c.baseten_validated_at,
    c.modal_worker_error_code
  from (select v_user_id as user_id) as request_user
  left join private.user_provider_credentials as c
    on c.user_id = request_user.user_id;
end;
$$;

revoke all on function public.get_provider_setup_status()
  from public, anon;
grant execute on function public.get_provider_setup_status()
  to authenticated, service_role;

create or replace function public.get_provider_configuration_for_service(
  p_user_id uuid
)
returns table (
  modal_token_id text,
  modal_token_secret text,
  modal_app_name text,
  modal_environment text,
  baseten_api_key text,
  baseten_base_url text,
  baseten_model_id text,
  modal_config_generation bigint,
  baseten_config_generation bigint,
  modal_connection_state text,
  baseten_connection_state text,
  modal_worker_state text,
  modal_worker_revision text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    modal_id.decrypted_secret,
    modal_secret.decrypted_secret,
    coalesce(c.modal_app_name, 'forge-mvp'),
    coalesce(c.modal_environment, 'main'),
    baseten_key.decrypted_secret,
    coalesce(c.baseten_base_url, 'https://inference.baseten.co/v1'),
    coalesce(c.baseten_model_id, 'zai-org/GLM-5.2-Fast'),
    coalesce(c.modal_config_generation, 0),
    coalesce(c.baseten_config_generation, 0),
    coalesce(c.modal_connection_state, 'missing'),
    coalesce(c.baseten_connection_state, 'missing'),
    coalesce(c.modal_worker_state, 'missing'),
    c.modal_worker_revision
  from (select p_user_id as user_id) as request_user
  left join private.user_provider_credentials as c
    on c.user_id = request_user.user_id
  left join vault.decrypted_secrets as modal_id
    on modal_id.id = c.modal_token_id_secret_id
  left join vault.decrypted_secrets as modal_secret
    on modal_secret.id = c.modal_token_secret_secret_id
  left join vault.decrypted_secrets as baseten_key
    on baseten_key.id = c.baseten_api_key_secret_id
  where exists (
    select 1 from auth.users where id = request_user.user_id
  );
$$;

revoke all on function public.get_provider_configuration_for_service(uuid)
  from public, anon, authenticated;
grant execute on function public.get_provider_configuration_for_service(uuid)
  to service_role;

drop function if exists public.get_ready_provider_credentials_for_service(uuid);

create or replace function public.get_ready_provider_credentials_for_service(
  p_user_id uuid,
  p_worker_revision text
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
    case
      when c.modal_connection_state = 'valid'
        and c.modal_worker_state = 'ready'
        and c.modal_worker_revision is not distinct from p_worker_revision
        then modal_id.decrypted_secret
      else null
    end,
    case
      when c.modal_connection_state = 'valid'
        and c.modal_worker_state = 'ready'
        and c.modal_worker_revision is not distinct from p_worker_revision
        then modal_secret.decrypted_secret
      else null
    end,
    c.modal_app_name,
    c.modal_environment,
    case
      when c.baseten_connection_state = 'valid'
        then baseten_key.decrypted_secret
      else null
    end,
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

revoke all on function public.get_ready_provider_credentials_for_service(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_ready_provider_credentials_for_service(uuid, text)
  to service_role;

create or replace function public.save_validated_provider_configuration_for_service(
  p_user_id uuid,
  p_expected_modal_generation bigint,
  p_expected_baseten_generation bigint,
  p_update_modal boolean,
  p_update_baseten boolean,
  p_modal_token_id text,
  p_modal_token_secret text,
  p_modal_environment text,
  p_baseten_api_key text,
  p_baseten_model_id text,
  p_modal_credentials_validated boolean,
  p_baseten_credentials_validated boolean
)
returns table (
  modal_config_generation bigint,
  baseten_config_generation bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modal_token_id uuid;
  v_modal_token_secret uuid;
  v_baseten_api_key uuid;
  v_modal_generation bigint;
  v_baseten_generation bigint;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id
  ) then
    raise exception 'User not found'
      using errcode = 'P0002';
  end if;

  if not coalesce(p_update_modal, false)
    and not coalesce(p_update_baseten, false)
  then
    raise exception 'No provider changes supplied'
      using errcode = '22023';
  end if;

  if coalesce(p_update_modal, false) then
    if not coalesce(p_modal_credentials_validated, false)
      or nullif(btrim(p_modal_token_id), '') is null
      or nullif(btrim(p_modal_token_secret), '') is null
      or nullif(btrim(p_modal_environment), '') is null
    then
      raise exception 'Validated Modal credentials are required'
        using errcode = '22023';
    end if;
    if length(coalesce(p_modal_environment, '')) > 64 then
      raise exception 'Modal environment is too large'
        using errcode = '22001';
    end if;
  end if;

  if nullif(btrim(p_baseten_api_key), '') is not null
    and not coalesce(p_baseten_credentials_validated, false)
  then
    raise exception 'Validated Baseten credentials are required'
      using errcode = '22023';
  end if;
  if length(coalesce(p_baseten_model_id, '')) > 512 then
    raise exception 'Baseten model configuration is too large'
      using errcode = '22001';
  end if;

  insert into private.user_provider_credentials (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select
    c.modal_token_id_secret_id,
    c.modal_token_secret_secret_id,
    c.baseten_api_key_secret_id,
    c.modal_config_generation,
    c.baseten_config_generation
  into
    v_modal_token_id,
    v_modal_token_secret,
    v_baseten_api_key,
    v_modal_generation,
    v_baseten_generation
  from private.user_provider_credentials as c
  where c.user_id = p_user_id
  for update;

  if coalesce(p_update_modal, false)
    and v_modal_generation is distinct from p_expected_modal_generation
  then
    raise exception 'Modal configuration changed; retry'
      using errcode = '40001';
  end if;
  if coalesce(p_update_baseten, false)
    and v_baseten_generation is distinct from p_expected_baseten_generation
  then
    raise exception 'Baseten configuration changed; retry'
      using errcode = '40001';
  end if;

  if coalesce(p_update_modal, false) then
    v_modal_token_id := private.upsert_vault_secret(
      v_modal_token_id,
      btrim(p_modal_token_id),
      'forge:' || p_user_id::text || ':modal-token-id',
      'Forge user Modal token ID'
    );
    v_modal_token_secret := private.upsert_vault_secret(
      v_modal_token_secret,
      btrim(p_modal_token_secret),
      'forge:' || p_user_id::text || ':modal-token-secret',
      'Forge user Modal token secret'
    );
  end if;

  if nullif(btrim(p_baseten_api_key), '') is not null then
    v_baseten_api_key := private.upsert_vault_secret(
      v_baseten_api_key,
      btrim(p_baseten_api_key),
      'forge:' || p_user_id::text || ':baseten-api-key',
      'Forge user Baseten API key'
    );
  end if;

  update private.user_provider_credentials
  set
    modal_token_id_secret_id = case
      when p_update_modal then v_modal_token_id
      else modal_token_id_secret_id
    end,
    modal_token_secret_secret_id = case
      when p_update_modal then v_modal_token_secret
      else modal_token_secret_secret_id
    end,
    modal_app_name = case
      when p_update_modal then 'forge-mvp'
      else modal_app_name
    end,
    modal_environment = case
      when p_update_modal then btrim(p_modal_environment)
      else modal_environment
    end,
    modal_config_generation = modal_config_generation
      + case when p_update_modal then 1 else 0 end,
    modal_connection_state = case
      when p_update_modal then 'valid'
      else modal_connection_state
    end,
    modal_validated_at = case
      when p_update_modal then now()
      else modal_validated_at
    end,
    modal_worker_state = case
      when p_update_modal then 'pending'
      else modal_worker_state
    end,
    modal_worker_revision = case
      when p_update_modal then null
      else modal_worker_revision
    end,
    modal_worker_error_code = case
      when p_update_modal then null
      else modal_worker_error_code
    end,
    modal_worker_checked_at = case
      when p_update_modal then null
      else modal_worker_checked_at
    end,
    modal_provisioning_started_at = case
      when p_update_modal then null
      else modal_provisioning_started_at
    end,
    modal_provisioning_lease_id = case
      when p_update_modal then null
      else modal_provisioning_lease_id
    end,
    baseten_api_key_secret_id = case
      when nullif(btrim(p_baseten_api_key), '') is not null
        then v_baseten_api_key
      else baseten_api_key_secret_id
    end,
    baseten_model_id = case
      when p_update_baseten
        then coalesce(nullif(btrim(p_baseten_model_id), ''), baseten_model_id)
      else baseten_model_id
    end,
    baseten_config_generation = baseten_config_generation
      + case when p_update_baseten then 1 else 0 end,
    baseten_connection_state = case
      when nullif(btrim(p_baseten_api_key), '') is not null then 'valid'
      else baseten_connection_state
    end,
    baseten_validated_at = case
      when nullif(btrim(p_baseten_api_key), '') is not null then now()
      else baseten_validated_at
    end,
    updated_at = now()
  where user_id = p_user_id;

  update public.profiles
  set
    onboarding_seen_at = coalesce(onboarding_seen_at, now()),
    updated_at = now()
  where id = p_user_id;

  return query
  select
    c.modal_config_generation,
    c.baseten_config_generation
  from private.user_provider_credentials as c
  where c.user_id = p_user_id;
end;
$$;

revoke all on function public.save_validated_provider_configuration_for_service(
  uuid, bigint, bigint, boolean, boolean, text, text, text, text, text,
  boolean, boolean
) from public, anon, authenticated;
grant execute on function public.save_validated_provider_configuration_for_service(
  uuid, bigint, bigint, boolean, boolean, text, text, text, text, text,
  boolean, boolean
) to service_role;

-- Remove any pre-release, unfenced overload before installing the leased
-- provisioning contract.
drop function if exists public.begin_modal_provisioning_for_service(
  uuid, bigint, text
);

create or replace function public.begin_modal_provisioning_for_service(
  p_user_id uuid,
  p_expected_generation bigint,
  p_worker_revision text,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_rows integer;
begin
  if p_lease_id is null then
    raise exception 'modal_provisioning_lease_required';
  end if;

  update private.user_provider_credentials
  set
    modal_worker_state = 'provisioning',
    modal_worker_revision = p_worker_revision,
    modal_worker_error_code = null,
    modal_provisioning_started_at = now(),
    modal_provisioning_lease_id = p_lease_id
  where user_id = p_user_id
    and modal_config_generation = p_expected_generation
    and modal_connection_state = 'valid'
    and modal_token_id_secret_id is not null
    and modal_token_secret_secret_id is not null
    and (
      modal_worker_state in ('pending', 'error')
      or (
        modal_worker_state = 'ready'
        and modal_worker_revision is distinct from p_worker_revision
      )
      or (
        modal_worker_state = 'provisioning'
        and modal_provisioning_started_at < now() - interval '25 minutes'
      )
    );

  get diagnostics v_updated_rows = row_count;
  return v_updated_rows = 1;
end;
$$;

revoke all on function public.begin_modal_provisioning_for_service(
  uuid, bigint, text, uuid
) from public, anon, authenticated;
grant execute on function public.begin_modal_provisioning_for_service(
  uuid, bigint, text, uuid
) to service_role;

drop function if exists public.finish_modal_provisioning_for_service(
  uuid, bigint, text, boolean, text
);

create or replace function public.finish_modal_provisioning_for_service(
  p_user_id uuid,
  p_expected_generation bigint,
  p_worker_revision text,
  p_lease_id uuid,
  p_ready boolean,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_rows integer;
begin
  if p_lease_id is null then
    raise exception 'modal_provisioning_lease_required';
  end if;

  update private.user_provider_credentials
  set
    modal_worker_state = case when p_ready then 'ready' else 'error' end,
    modal_worker_revision = case
      when p_ready then p_worker_revision
      else modal_worker_revision
    end,
    modal_worker_error_code = case
      when p_ready then null
      else coalesce(nullif(btrim(p_error_code), ''), 'modal_provision_failed')
    end,
    modal_worker_checked_at = now(),
    modal_provisioning_started_at = null,
    modal_provisioning_lease_id = null
  where user_id = p_user_id
    and modal_config_generation = p_expected_generation
    and modal_worker_state = 'provisioning'
    and modal_worker_revision is not distinct from p_worker_revision
    and modal_provisioning_lease_id = p_lease_id;

  get diagnostics v_updated_rows = row_count;
  return v_updated_rows = 1;
end;
$$;

revoke all on function public.finish_modal_provisioning_for_service(
  uuid, bigint, text, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.finish_modal_provisioning_for_service(
  uuid, bigint, text, uuid, boolean, text
) to service_role;

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
    modal_app_name = 'forge-mvp',
    modal_environment = coalesce(
      nullif(btrim(p_modal_environment), ''),
      modal_environment
    ),
    baseten_base_url = 'https://inference.baseten.co/v1',
    baseten_model_id = coalesce(
      nullif(btrim(p_baseten_model_id), ''),
      baseten_model_id
    ),
    modal_config_generation = modal_config_generation + 1,
    baseten_config_generation = baseten_config_generation + 1,
    modal_connection_state = 'unavailable',
    baseten_connection_state = 'unavailable',
    modal_validated_at = null,
    baseten_validated_at = null,
    modal_worker_state = 'pending',
    modal_worker_revision = null,
    modal_worker_error_code = null,
    modal_worker_checked_at = null,
    modal_provisioning_started_at = null,
    modal_provisioning_lease_id = null,
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
