from typing import Literal

from pydantic import BaseModel, Field

from forge_api.models.domain import RecipeId


class CreateSessionRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2)
    baseModel: str | None = Field(default=None, min_length=2)
    model: str | None = Field(default=None, min_length=2)
    recipe: RecipeId = "chat-sft"
    targetSteps: int | None = Field(default=None, ge=1, le=5000)


class ForwardBackwardRequest(BaseModel):
    runId: str | None = None
    microbatches: int = Field(default=4, ge=1, le=64)


class CreateCheckpointRequest(BaseModel):
    runId: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1)
    kind: Literal["state", "sampler_weights", "export"] | None = None


class CreateDeploymentRequest(BaseModel):
    checkpointId: str = Field(min_length=1)
    target: Literal["baseten", "modal"] = "baseten"


class Message(BaseModel):
    role: str
    content: str


class SamplingInput(BaseModel):
    type: str | None = None
    messages: list[Message] | None = None


class SamplingRequest(BaseModel):
    sessionId: str | None = Field(default=None, min_length=1)
    samplingClientId: str | None = Field(default=None, min_length=1)
    prompt: str | None = None
    input: SamplingInput | None = None


class DeploymentInvokeRequest(BaseModel):
    messages: list[Message] | None = None
    prompt: str | None = None


class Criterion(BaseModel):
    name: str
    weight: float


class VerificationRequest(BaseModel):
    candidate: str = Field(min_length=1)
    rubric: str | None = None
    reference: str | None = None
    criteria: list[Criterion] | None = None


class RankRequest(BaseModel):
    candidates: list[str] = Field(min_length=1)
    rubric: str | None = None
    reference: str | None = None
    criteria: list[Criterion] | None = None


class TrajectoryRequest(BaseModel):
    events: list[str | Message] = Field(min_length=1)
    rubric: str | None = None
