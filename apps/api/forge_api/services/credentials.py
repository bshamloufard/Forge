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
            f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/get_provider_credentials_for_service",
            headers={
                "apikey": service_key,
                "authorization": f"Bearer {service_key}",
                "content-type": "application/json",
            },
            json={"p_user_id": identity.safe_user_id},
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


def _optional_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None
