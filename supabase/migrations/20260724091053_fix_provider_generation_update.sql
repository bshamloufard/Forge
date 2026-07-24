-- Qualify generation columns that collide with RETURNS TABLE output names.
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

  update private.user_provider_credentials as c
  set
    modal_token_id_secret_id = case
      when p_update_modal then v_modal_token_id
      else c.modal_token_id_secret_id
    end,
    modal_token_secret_secret_id = case
      when p_update_modal then v_modal_token_secret
      else c.modal_token_secret_secret_id
    end,
    modal_app_name = case
      when p_update_modal then 'forge-mvp'
      else c.modal_app_name
    end,
    modal_environment = case
      when p_update_modal then btrim(p_modal_environment)
      else c.modal_environment
    end,
    modal_config_generation = c.modal_config_generation
      + case when p_update_modal then 1 else 0 end,
    modal_connection_state = case
      when p_update_modal then 'valid'
      else c.modal_connection_state
    end,
    modal_validated_at = case
      when p_update_modal then now()
      else c.modal_validated_at
    end,
    modal_worker_state = case
      when p_update_modal then 'pending'
      else c.modal_worker_state
    end,
    modal_worker_revision = case
      when p_update_modal then null
      else c.modal_worker_revision
    end,
    modal_worker_error_code = case
      when p_update_modal then null
      else c.modal_worker_error_code
    end,
    modal_worker_checked_at = case
      when p_update_modal then null
      else c.modal_worker_checked_at
    end,
    modal_provisioning_started_at = case
      when p_update_modal then null
      else c.modal_provisioning_started_at
    end,
    modal_provisioning_lease_id = case
      when p_update_modal then null
      else c.modal_provisioning_lease_id
    end,
    baseten_api_key_secret_id = case
      when nullif(btrim(p_baseten_api_key), '') is not null
        then v_baseten_api_key
      else c.baseten_api_key_secret_id
    end,
    baseten_model_id = case
      when p_update_baseten
        then coalesce(nullif(btrim(p_baseten_model_id), ''), c.baseten_model_id)
      else c.baseten_model_id
    end,
    baseten_config_generation = c.baseten_config_generation
      + case when p_update_baseten then 1 else 0 end,
    baseten_connection_state = case
      when nullif(btrim(p_baseten_api_key), '') is not null then 'valid'
      else c.baseten_connection_state
    end,
    baseten_validated_at = case
      when nullif(btrim(p_baseten_api_key), '') is not null then now()
      else c.baseten_validated_at
    end,
    updated_at = now()
  where c.user_id = p_user_id;

  update public.profiles as p
  set
    onboarding_seen_at = coalesce(p.onboarding_seen_at, now()),
    updated_at = now()
  where p.id = p_user_id;

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
