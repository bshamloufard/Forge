from collections.abc import Callable
from typing import Any, Generic, TypeVar

import httpx

from forge.types import Checkpoint, SampleResult

T = TypeVar("T")


class APIFuture(Generic[T]):
    def __init__(self, resolver: Callable[[], T]):
        self._resolver = resolver
        self._resolved = False
        self._value: T | None = None

    def result(self) -> T:
        if not self._resolved:
            self._value = self._resolver()
            self._resolved = True
        return self._value  # type: ignore[return-value]


class ServiceClient:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = "http://localhost:8000",
        timeout: float = 30,
    ):
        self.base_url = base_url.rstrip("/")
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.Client(base_url=self.base_url, headers=headers, timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def get_server_capabilities(self) -> dict[str, Any]:
        return self._request("GET", "/v1/capabilities")

    def create_training_client(
        self,
        project_id: str | None = None,
        model: str = "qwen3-8b",
        recipe: str = "chat-sft",
        name: str | None = None,
        target_steps: int | None = None,
    ) -> "TrainingClient":
        payload = {
            "model": model,
            "recipe": recipe,
            "name": name or f"{recipe} session",
            "targetSteps": target_steps,
        }
        response = self._request("POST", "/v1/sessions", json={key: value for key, value in payload.items() if value is not None})
        return TrainingClient(self, session=response["session"], run=response["run"], project_id=project_id)

    def create_lora_training_client(
        self,
        base_model: str = "qwen3-8b",
        rank: int = 16,
        recipe: str = "chat-sft",
        target_steps: int | None = None,
    ) -> "TrainingClient":
        client = self.create_training_client(model=base_model, recipe=recipe, target_steps=target_steps)
        client.lora_rank = rank
        return client

    def create_sampling_client(self, checkpoint_id: str | None = None, session_id: str | None = None) -> "SamplingClient":
        return SamplingClient(self, checkpoint_id=checkpoint_id, session_id=session_id)

    def create_rest_client(self) -> "ServiceClient":
        return self

    def get_checkpoint_archive_url_from_tinker_path(self, path: str) -> APIFuture[bytes]:
        return APIFuture(lambda: f"mock checkpoint archive for {path}".encode())

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        response = self._client.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()


class TrainingClient:
    def __init__(self, service: ServiceClient, session: dict[str, Any], run: dict[str, Any], project_id: str | None):
        self.service = service
        self.session = session
        self.run = run
        self.project_id = project_id or session.get("projectId")
        self.lora_rank = 16

    @property
    def id(self) -> str:
        return self.run["id"]

    def forward_backward(self, batch: Any | None = None, microbatches: int = 4) -> dict[str, Any]:
        response = self.service._request(
            "POST",
            f"/v1/training-runs/{self.id}/forward-backward",
            json={"microbatches": microbatches},
        )
        self.run = response["run"]
        return response

    def optim_step(self) -> dict[str, Any]:
        response = self.service._request("POST", f"/v1/training-runs/{self.id}/optim-step", json={})
        self.run = response["run"]
        return response

    def save_state(self, name: str | None = None) -> Checkpoint:
        response = self.service._request("POST", "/v1/checkpoints", json={"runId": self.id, "name": name})
        return Checkpoint.model_validate(response["checkpoint"])

    def load_state(self, checkpoint_id: str) -> dict[str, Any]:
        return {"checkpoint_id": checkpoint_id, "status": "loaded"}

    def save_weights_and_get_sampling_client(self) -> "SamplingClient":
        checkpoint = self.save_state()
        return SamplingClient(self.service, checkpoint_id=checkpoint.id, session_id=checkpoint.sessionId)


class SamplingClient:
    def __init__(self, service: ServiceClient, checkpoint_id: str | None = None, session_id: str | None = None):
        self.service = service
        self.checkpoint_id = checkpoint_id
        self.session_id = session_id

    def sample(self, prompt: str, **kwargs: Any) -> SampleResult:
        payload = {"sessionId": self.session_id, "prompt": prompt, **kwargs}
        response = self.service._request("POST", "/v1/sampling-jobs", json=payload)
        return SampleResult.model_validate(response)

    def compute_logprobs(self, prompt: str) -> dict[str, Any]:
        return {"prompt": prompt, "token_logprobs": [], "status": "mock"}

