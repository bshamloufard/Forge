from typing import Literal

from pydantic import BaseModel, Field

ProviderMode = Literal["mock", "configured"]
RunStatus = Literal["queued", "running", "completed", "failed"]
RecipeId = Literal["chat-sft", "math-rl", "tool-rl", "harbor-agent-rl"]


class Project(BaseModel):
    id: str
    name: str
    organization: str
    createdAt: str


class Session(BaseModel):
    id: str
    projectId: str
    name: str
    creator: str
    model: str
    recipe: RecipeId
    provider: Literal["modal"] = "modal"
    createdAt: str
    updatedAt: str


class TrainingRun(BaseModel):
    id: str
    sessionId: str
    name: str
    status: RunStatus
    step: int
    targetSteps: int
    loss: float
    reward: float
    verifierScore: float
    tokens: int
    costUsd: float
    logs: list[str] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class Checkpoint(BaseModel):
    id: str
    sessionId: str
    runId: str
    name: str
    step: int
    adapterType: Literal["lora"] = "lora"
    artifactUri: str
    score: float
    createdAt: str


class Deployment(BaseModel):
    id: str
    checkpointId: str
    target: Literal["baseten", "modal"]
    status: Literal["draft", "deploying", "live", "failed"]
    endpointUrl: str
    mode: ProviderMode
    createdAt: str


class VerifierScore(BaseModel):
    id: str
    candidate: str
    rubric: str
    score: float
    confidence: float
    rationale: str
    createdAt: str


class ProviderHealth(BaseModel):
    modal: ProviderMode
    baseten: ProviderMode
    supabase: ProviderMode


class ForgeState(BaseModel):
    project: Project
    sessions: list[Session]
    runs: list[TrainingRun]
    checkpoints: list[Checkpoint]
    deployments: list[Deployment]
    verifierScores: list[VerifierScore]

