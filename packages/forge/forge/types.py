from typing import Any

from pydantic import BaseModel


class ForgeObject(BaseModel):
    id: str

    model_config = {"extra": "allow"}


class Checkpoint(ForgeObject):
    name: str
    runId: str
    sessionId: str
    artifactUri: str
    score: float


class SampleResult(BaseModel):
    output: str
    session: dict[str, Any]

