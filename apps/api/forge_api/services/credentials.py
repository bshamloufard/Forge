from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import httpx

from forge_api.settings import Settings


@dataclass(frozen=True)
class RequestIdentity:
    user_id: str
    email: str | None = None
    authenticated: bool = False

    @property
    def safe_user_id(self) -> str:
        if not self.authenticated:
            return "local-default"
        return str(UUID(self.user_id))


@dataclass(frozen=True)
class ProviderConfigurationSnapshot:
    settings: Settings
    modal_generation: int
    baseten_generation: int
    modal_connection_state: str
    baseten_connection_state: str
    modal_worker_state: str
    modal_worker_revision: str | None


class ProviderConfigurationStoreError(RuntimeError):
    pass


class ProviderConfigurationConflict(ProviderConfigurationStoreError):
    pass


def settings_for_identity(settings: Settings, identity: RequestIdentity) -> Settings:
    """Return request-scoped provider settings without leaking the owner's env keys."""
    if not identity.authenticated:
        return settings

    provider_settings = {
        "modal_token_id": None,
        "modal_token_secret": None,
        "baseten_api_key": None,
    }
    service_key = settings.supabase_secret_key or settings.supabase_service_role_key
    if not settings.supabase_url or not service_key:
        return settings.model_copy(update=provider_settings)

    try:
        response = httpx.post(
            f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/get_ready_provider_credentials_for_service",
            headers={
                "apikey": service_key,
                "authorization": f"Bearer {service_key}",
                "content-type": "application/json",
            },
            json={
                "p_user_id": identity.safe_user_id,
                "p_worker_revision": settings.forge_modal_worker_revision,
            },
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return settings.model_copy(update=provider_settings)

    record = payload[0] if isinstance(payload, list) and payload else None
    if not isinstance(record, dict):
        return settings.model_copy(update=provider_settings)

    modal_token_id = _optional_string(record.get("modal_token_id"))
    modal_token_secret = _optional_string(record.get("modal_token_secret"))
    baseten_api_key = _optional_string(record.get("baseten_api_key"))
    baseten_model_id = _optional_string(record.get("baseten_model_id"))

    return settings.model_copy(
        update={
            "modal_token_id": modal_token_id,
            "modal_token_secret": modal_token_secret,
            "modal_app_name": _optional_string(record.get("modal_app_name")) or settings.modal_app_name,
            "modal_environment": _optional_string(record.get("modal_environment")) or settings.modal_environment,
            "baseten_api_key": baseten_api_key,
            "baseten_base_url": _optional_string(record.get("baseten_base_url")) or settings.baseten_base_url,
            "baseten_model_id": baseten_model_id or settings.baseten_model_id,
            "baseten_default_model": baseten_model_id or settings.baseten_default_model,
        }
    )


def provider_configuration_for_setup(
    settings: Settings,
    identity: RequestIdentity,
) -> ProviderConfigurationSnapshot:
    if not identity.authenticated:
        raise ProviderConfigurationStoreError(
            "Authenticated identity is required"
        )

    payload = _service_rpc(
        settings,
        "get_provider_configuration_for_service",
        {"p_user_id": identity.safe_user_id},
    )
    record = payload[0] if isinstance(payload, list) and payload else None
    if not isinstance(record, dict):
        raise ProviderConfigurationStoreError(
            "Provider configuration is unavailable"
        )

    provider_settings = settings.model_copy(
        update={
            "modal_token_id": _optional_string(record.get("modal_token_id")),
            "modal_token_secret": _optional_string(
                record.get("modal_token_secret")
            ),
            "modal_app_name": _optional_string(record.get("modal_app_name"))
            or settings.modal_app_name,
            "modal_environment": _optional_string(
                record.get("modal_environment")
            )
            or settings.modal_environment,
            "baseten_api_key": _optional_string(record.get("baseten_api_key")),
            "baseten_base_url": _optional_string(
                record.get("baseten_base_url")
            )
            or settings.baseten_base_url,
            "baseten_model_id": _optional_string(
                record.get("baseten_model_id")
            )
            or settings.baseten_model_id,
            "baseten_default_model": _optional_string(
                record.get("baseten_model_id")
            )
            or settings.baseten_default_model,
        }
    )
    return ProviderConfigurationSnapshot(
        settings=provider_settings,
        modal_generation=_nonnegative_integer(
            record.get("modal_config_generation")
        ),
        baseten_generation=_nonnegative_integer(
            record.get("baseten_config_generation")
        ),
        modal_connection_state=_state_string(
            record.get("modal_connection_state"),
            "missing",
        ),
        baseten_connection_state=_state_string(
            record.get("baseten_connection_state"),
            "missing",
        ),
        modal_worker_state=_state_string(
            record.get("modal_worker_state"),
            "missing",
        ),
        modal_worker_revision=_optional_string(
            record.get("modal_worker_revision")
        ),
    )


def save_validated_provider_configuration(
    settings: Settings,
    identity: RequestIdentity,
    snapshot: ProviderConfigurationSnapshot,
    *,
    update_modal: bool,
    update_baseten: bool,
    modal_token_id: str | None,
    modal_token_secret: str | None,
    modal_environment: str | None,
    baseten_api_key: str | None,
    baseten_model_id: str | None,
    modal_credentials_validated: bool,
    baseten_credentials_validated: bool,
) -> tuple[int, int]:
    try:
        payload = _service_rpc(
            settings,
            "save_validated_provider_configuration_for_service",
            {
                "p_user_id": identity.safe_user_id,
                "p_expected_modal_generation": snapshot.modal_generation,
                "p_expected_baseten_generation": snapshot.baseten_generation,
                "p_update_modal": update_modal,
                "p_update_baseten": update_baseten,
                "p_modal_token_id": modal_token_id,
                "p_modal_token_secret": modal_token_secret,
                "p_modal_environment": modal_environment,
                "p_baseten_api_key": baseten_api_key,
                "p_baseten_model_id": baseten_model_id,
                "p_modal_credentials_validated": modal_credentials_validated,
                "p_baseten_credentials_validated": (
                    baseten_credentials_validated
                ),
            },
        )
    except ProviderConfigurationStoreError as exc:
        if exc.args and exc.args[0] == "stale_configuration":
            raise ProviderConfigurationConflict(
                "Provider configuration changed"
            ) from exc
        raise

    record = payload[0] if isinstance(payload, list) and payload else None
    if not isinstance(record, dict):
        raise ProviderConfigurationStoreError(
            "Provider configuration save did not return a generation"
        )
    return (
        _nonnegative_integer(record.get("modal_config_generation")),
        _nonnegative_integer(record.get("baseten_config_generation")),
    )


def begin_modal_provisioning(
    settings: Settings,
    identity: RequestIdentity,
    *,
    generation: int,
    lease_id: str,
) -> bool:
    payload = _service_rpc(
        settings,
        "begin_modal_provisioning_for_service",
        {
            "p_user_id": identity.safe_user_id,
            "p_expected_generation": generation,
            "p_worker_revision": settings.forge_modal_worker_revision,
            "p_lease_id": lease_id,
        },
    )
    return payload is True


def finish_modal_provisioning(
    settings: Settings,
    identity: RequestIdentity,
    *,
    generation: int,
    lease_id: str,
    ready: bool,
    error_code: str | None,
) -> bool:
    payload = _service_rpc(
        settings,
        "finish_modal_provisioning_for_service",
        {
            "p_user_id": identity.safe_user_id,
            "p_expected_generation": generation,
            "p_worker_revision": settings.forge_modal_worker_revision,
            "p_lease_id": lease_id,
            "p_ready": ready,
            "p_error_code": error_code,
        },
    )
    return payload is True


def _service_rpc(
    settings: Settings,
    function_name: str,
    payload: dict[str, object],
) -> object:
    service_key = settings.supabase_secret_key or settings.supabase_service_role_key
    if not settings.supabase_url or not service_key:
        raise ProviderConfigurationStoreError(
            "Provider configuration service is unavailable"
        )

    try:
        response = httpx.post(
            f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/{function_name}",
            headers={
                "apikey": service_key,
                "authorization": f"Bearer {service_key}",
                "content-type": "application/json",
            },
            json=payload,
            timeout=10,
        )
    except httpx.RequestError as exc:
        raise ProviderConfigurationStoreError(
            "Provider configuration service is unavailable"
        ) from exc

    if response.is_error:
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = None
        error_code = (
            error_payload.get("code")
            if isinstance(error_payload, dict)
            else None
        )
        if error_code == "40001":
            raise ProviderConfigurationStoreError("stale_configuration")
        raise ProviderConfigurationStoreError(
            "Provider configuration service rejected the request"
        )

    try:
        return response.json()
    except ValueError as exc:
        raise ProviderConfigurationStoreError(
            "Provider configuration service returned invalid data"
        ) from exc


def _optional_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _nonnegative_integer(value: object) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return 0


def _state_string(value: object, default: str) -> str:
    value = _optional_string(value)
    return value or default
