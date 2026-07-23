from fastapi import APIRouter, Depends, HTTPException

from forge_api.dependencies import get_repository
from forge_api.models.requests import CreateCheckpointRequest
from forge_api.services.store import StateRepository

router = APIRouter(tags=["checkpoints"])


@router.get("/v1/checkpoints")
def get_checkpoints(repository: StateRepository = Depends(get_repository)) -> dict[str, object]:
    return {"checkpoints": [checkpoint.model_dump() for checkpoint in repository.read().checkpoints]}


@router.post("/v1/checkpoints")
@router.post("/api/checkpoints")
def create_checkpoint(
    body: CreateCheckpointRequest,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    try:
        return _dump(repository.save_checkpoint(body.runId, body.name))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _dump(result: dict[str, object]) -> dict[str, object]:
    return {key: value.model_dump() if hasattr(value, "model_dump") else value for key, value in result.items()}
