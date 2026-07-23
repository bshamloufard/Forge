from fastapi import APIRouter, Depends, HTTPException

from forge_api.dependencies import get_repository
from forge_api.models.requests import SamplingRequest
from forge_api.services.store import StateRepository

router = APIRouter(tags=["sampling"])


@router.get("/v1/sampling-jobs")
def get_sampling_jobs() -> dict[str, object]:
    return {"samplingJobs": []}


@router.post("/v1/sampling-jobs")
@router.post("/api/sample")
def create_sampling_job(
    body: SamplingRequest,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    state = repository.read()
    session_id = body.sessionId or body.samplingClientId or (state.sessions[0].id if state.sessions else None)
    prompt = body.prompt
    if prompt is None and body.input and body.input.messages:
        prompt = "\n".join(f"{message.role}: {message.content}" for message in body.input.messages)
    prompt = prompt or "Sample from the current adapter."
    if session_id is None:
        raise HTTPException(status_code=400, detail="No session available")
    try:
        result = repository.sample_from_session(session_id, prompt)
        return {"status": "succeeded", **_dump(result)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _dump(result: dict[str, object]) -> dict[str, object]:
    return {key: value.model_dump() if hasattr(value, "model_dump") else value for key, value in result.items()}

