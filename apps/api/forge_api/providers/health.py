from forge_api.models.domain import ProviderHealth, ProviderMode
from forge_api.settings import Settings


def _mode_for(value: object) -> ProviderMode:
    return "configured" if isinstance(value, str) and value.strip() else "mock"


def get_provider_health(settings: Settings) -> ProviderHealth:
    return ProviderHealth(
        modal=_mode_for(settings.modal_token_id or settings.modal_token_secret),
        baseten=_mode_for(settings.baseten_api_key),
        supabase=_mode_for(
            settings.supabase_url and (settings.supabase_secret_key or settings.supabase_service_role_key)
        ),
    )


def create_serving_endpoint(name: str, target: str, settings: Settings) -> dict[str, str]:
    health = get_provider_health(settings)
    mode = getattr(health, target)
    slug = "-".join(part for part in "".join(ch.lower() if ch.isalnum() else "-" for ch in name).split("-") if part)

    if mode == "mock":
        return {
            "mode": mode,
            "endpointUrl": f"https://mock.forge.local/v1/{target}/{slug or 'checkpoint'}",
        }

    endpoint = (
        settings.baseten_base_url
        if target == "baseten"
        else f"https://{slug or 'checkpoint'}--forge-modal.modal.run/v1"
    )
    return {"mode": mode, "endpointUrl": endpoint}

