from fastapi import APIRouter, Body, Depends, HTTPException

from forge_api.dependencies import get_repository
from forge_api.models.requests import ForwardBackwardRequest
from forge_api.services.store import StateRepository

router = APIRouter(tags=["runs"])


@router.get("/v1/runs")
def get_runs(repository: StateRepository = Depends(get_repository)) -> dict[str, object]:
    return {"runs": [run.model_dump() for run in repository.read().runs]}


@router.post("/v1/training-runs/{run_id}/forward-backward")
@router.post("/api/training/forward_backward")
def forward_backward(
    run_id: str | None = None,
    body: ForwardBackwardRequest = ForwardBackwardRequest(),
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    try:
        target_run_id = run_id or body.runId
        if target_run_id is None:
            raise KeyError("Run not found")
        return _dump(repository.forward_backward(target_run_id, body.microbatches))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/v1/training-runs/{run_id}/optim-step")
@router.post("/api/training/optim_step")
def optim_step(
    run_id: str | None = None,
    body: dict[str, str] = Body(default_factory=dict),
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    try:
        target_run_id = run_id or body.get("runId")
        if target_run_id is None:
            raise KeyError("Run not found")
        return _dump(repository.optim_step(target_run_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _dump(result: dict[str, object]) -> dict[str, object]:
    return {key: value.model_dump() if hasattr(value, "model_dump") else value for key, value in result.items()}
