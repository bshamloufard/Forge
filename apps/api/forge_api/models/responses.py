from pydantic import BaseModel

from forge_api.models.domain import (
    Checkpoint,
    Deployment,
    ForgeState,
    Project,
    ProviderHealth,
    Session,
    TrainingRun,
    VerifierScore,
)


class StateResponse(ForgeState):
    providers: ProviderHealth


class ProjectsResponse(BaseModel):
    projects: list[Project]


class SessionsResponse(BaseModel):
    sessions: list[Session]


class RunsResponse(BaseModel):
    runs: list[TrainingRun]


class CheckpointsResponse(BaseModel):
    checkpoints: list[Checkpoint]


class DeploymentsResponse(BaseModel):
    deployments: list[Deployment]


class CreateSessionResponse(BaseModel):
    state: ForgeState
    session: Session
    run: TrainingRun


class RunMutationResponse(BaseModel):
    state: ForgeState
    run: TrainingRun


class CheckpointResponse(BaseModel):
    state: ForgeState
    checkpoint: Checkpoint


class DeploymentResponse(BaseModel):
    state: ForgeState
    deployment: Deployment


class VerifyResponse(BaseModel):
    state: ForgeState
    verifierScore: VerifierScore
    score: float
    confidence: float
    pass_: bool
    uncertainty: float
    criterion_scores: dict[str, float]
    evidence: list[dict[str, object]]
    rationale: str
