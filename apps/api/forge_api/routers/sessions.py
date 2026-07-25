from fastapi import APIRouter, Depends, HTTPException

from forge_api.dependencies import get_repository
from forge_api.models.requests import CreateSessionRequest
from forge_api.services.datasets import DatasetValidationError
from forge_api.services.store import StateRepository

router = APIRouter(tags=["sessions"])


@router.get("/v1/sessions")
def get_sessions(repository: StateRepository = Depends(get_repository)) -> dict[str, object]:
    return {"sessions": [session.model_dump() for session in repository.read().sessions]}


@router.post("/v1/sessions")
@router.post("/api/sessions")
def create_session(
    body: CreateSessionRequest,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    try:
        result = repository.create_session(
            name=body.name or f"{body.recipe} session",
            model=body.model or body.baseModel or repository.settings.training_model_id,
            recipe=body.recipe,
            dataset_id=body.datasetId,
            target_steps=body.targetSteps,
        )
        return _dump(result)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DatasetValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _dump(result: dict[str, object]) -> dict[str, object]:
    return {key: value.model_dump() if hasattr(value, "model_dump") else value for key, value in result.items()}
