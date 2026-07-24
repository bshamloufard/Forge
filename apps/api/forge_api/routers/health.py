from fastapi import APIRouter, Depends

from forge_api.settings import Settings, get_settings
from forge_api.services.store import now

router = APIRouter(tags=["health"])


@router.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {
        "ok": True,
        "service": "forge-api",
        "timestamp": now(),
        "environment": settings.app_env,
    }


@router.get("/api/health")
def legacy_health(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return health(settings)
