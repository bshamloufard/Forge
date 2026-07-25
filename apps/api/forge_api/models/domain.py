from typing import Any, Literal

from pydantic import BaseModel, Field

ProviderMode = Literal["mock", "configured"]
RunStatus = Literal["queued", "running", "completed", "failed"]
RecipeId = Literal["chat-sft", "math-rl", "tool-rl", "harbor-agent-rl"]
DatasetSourceType = Literal["huggingface", "upload"]
DatasetStatus = Literal["ready", "needs_mapping", "failed"]
DatasetFormat = Literal["text", "prompt_response", "messages"]


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
    datasetId: str | None = None
    provider: Literal["modal"] = "modal"
    createdAt: str
    updatedAt: str


class TrainingRun(BaseModel):
    id: str
    sessionId: str
    name: str
    datasetId: str | None = None
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
    status: Literal["draft", "deploying", "live", "failed", "stopped"]
    endpointUrl: str
    mode: ProviderMode
    artifactUri: str | None = None
    providerModelId: str | None = None
    providerDeploymentId: str | None = None
    providerDeploymentName: str | None = None
    logsUrl: str | None = None
    createdAt: str


class VerifierScore(BaseModel):
    id: str
    candidate: str
    rubric: str
    score: float
    confidence: float
    rationale: str
    createdAt: str


class DatasetAdapter(BaseModel):
    format: DatasetFormat
    textField: str | None = None
    promptField: str | None = None
    responseField: str | None = None
    inputField: str | None = None
    messagesField: str | None = None
    roleField: str | None = None
    contentField: str | None = None
    roleMap: dict[str, str] = Field(default_factory=dict)
    canonicalVersion: Literal["forge-chat-v1"] = "forge-chat-v1"


class DatasetQuality(BaseModel):
    inspectedRows: int = 0
    validRows: int = 0
    invalidRows: int = 0
    duplicateRows: int = 0
    averageCharacters: int = 0


class Dataset(BaseModel):
    id: str
    projectId: str
    name: str
    sourceType: DatasetSourceType
    sourceUri: str
    sourceConfig: str | None = None
    sourceSplit: str = "train"
    sourceRevision: str | None = None
    fileName: str | None = None
    contentType: str | None = None
    byteSize: int | None = None
    storageUri: str | None = None
    status: DatasetStatus
    adapter: DatasetAdapter | None = None
    columns: list[str] = Field(default_factory=list)
    rowCount: int | None = None
    preview: list[dict[str, Any]] = Field(default_factory=list)
    canonicalPreview: list[str] = Field(default_factory=list)
    quality: DatasetQuality = Field(default_factory=DatasetQuality)
    warnings: list[str] = Field(default_factory=list)
    validationErrors: list[str] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class ProviderHealth(BaseModel):
    modal: ProviderMode
    baseten: ProviderMode
    supabase: ProviderMode


class ForgeState(BaseModel):
    project: Project
    datasets: list[Dataset] = Field(default_factory=list)
    sessions: list[Session]
    runs: list[TrainingRun]
    checkpoints: list[Checkpoint]
    deployments: list[Deployment]
    verifierScores: list[VerifierScore]
