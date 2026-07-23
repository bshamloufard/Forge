from fastapi import APIRouter, Depends

from forge_api.dependencies import get_repository
from forge_api.models.requests import RankRequest, TrajectoryRequest, VerificationRequest
from forge_api.services.store import StateRepository
from forge_api.services.verifier import rank_candidates, score_trajectory

router = APIRouter(tags=["verifier"])


@router.post("/v1/verifier/verify")
@router.post("/v1/verifier/score")
@router.post("/api/verify")
def verify(
    body: VerificationRequest,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    result = repository.verify_candidate(
        body.candidate,
        body.rubric,
        body.reference,
        [criterion.model_dump() for criterion in body.criteria] if body.criteria else None,
    )
    return _dump(result)


@router.post("/v1/verifier/rank")
@router.post("/api/rank")
def rank(body: RankRequest) -> dict[str, object]:
    return rank_candidates(
        body.candidates,
        body.rubric or "",
        body.reference or "",
        [criterion.model_dump() for criterion in body.criteria] if body.criteria else None,
    )


@router.post("/v1/verifier/score-trajectory")
@router.post("/v1/verifier/score_trajectory")
@router.post("/v1/verifier/progress")
@router.post("/v1/verifier/reward")
@router.post("/v1/verifier/trajectory")
@router.post("/api/trajectory")
def trajectory(body: TrajectoryRequest) -> dict[str, object]:
    events = [event if isinstance(event, str) else f"{event.role}: {event.content}" for event in body.events]
    return score_trajectory(events, body.rubric)


def _dump(result: dict[str, object]) -> dict[str, object]:
    return {key: value.model_dump() if hasattr(value, "model_dump") else value for key, value in result.items()}

