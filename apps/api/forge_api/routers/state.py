from fastapi import APIRouter, Depends

from forge_api.dependencies import get_repository
from forge_api.providers.health import get_provider_health
from forge_api.services.store import StateRepository

router = APIRouter(tags=["state"])


@router.get("/api/state")
def get_state(
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    return {
        **repository.read().model_dump(),
        "providers": get_provider_health(repository.settings).model_dump(),
    }


@router.delete("/api/state")
def reset_state(
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    return {
        **repository.reset().model_dump(),
        "providers": get_provider_health(repository.settings).model_dump(),
    }
