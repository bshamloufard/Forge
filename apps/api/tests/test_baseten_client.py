import httpx
import pytest

from forge_api.models.domain import Deployment
from forge_api.providers.baseten_client import (
    activate_deployment,
    deactivate_deployment,
    delete_model,
)
from forge_api.settings import Settings


def _deployment() -> Deployment:
    return Deployment(
        id="dep_1",
        checkpointId="ckpt_1",
        target="baseten",
        status="live",
        endpointUrl="https://model-1.api.baseten.co/predict",
        mode="configured",
        providerModelId="model/1",
        providerDeploymentId="deployment 1",
        createdAt="2026-07-25T00:00:00Z",
    )


def test_baseten_lifecycle_calls_management_api(monkeypatch):
    calls: list[tuple[str, str]] = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url))
        assert kwargs["headers"] == {"Authorization": "Bearer test-key"}
        return httpx.Response(
            200,
            request=httpx.Request(method, url),
            json={"success": True},
        )

    monkeypatch.setattr(httpx, "request", fake_request)
    settings = Settings(
        BASETEN_API_KEY="test-key",
        BASETEN_MANAGEMENT_BASE_URL="https://api.baseten.co/v1",
    )
    deployment = _deployment()

    activate_deployment(settings, deployment=deployment)
    deactivate_deployment(settings, deployment=deployment)
    delete_model(settings, deployment=deployment)

    assert calls == [
        (
            "POST",
            "https://api.baseten.co/v1/models/model%2F1/deployments/deployment%201/activate",
        ),
        (
            "POST",
            "https://api.baseten.co/v1/models/model%2F1/deployments/deployment%201/deactivate",
        ),
        ("DELETE", "https://api.baseten.co/v1/models/model%2F1"),
    ]


def test_baseten_delete_is_idempotent_when_provider_resource_is_missing(monkeypatch):
    def fake_request(method, url, **kwargs):
        return httpx.Response(404, request=httpx.Request(method, url))

    monkeypatch.setattr(httpx, "request", fake_request)
    result = delete_model(
        Settings(BASETEN_API_KEY="test-key"),
        deployment=_deployment(),
    )

    assert result == {"deleted": True, "alreadyMissing": True}


def test_baseten_pause_failure_is_reported_without_provider_response_body(monkeypatch):
    def fake_request(method, url, **kwargs):
        return httpx.Response(
            503,
            request=httpx.Request(method, url),
            text="sensitive upstream details",
        )

    monkeypatch.setattr(httpx, "request", fake_request)

    with pytest.raises(RuntimeError, match="Baseten deactivation failed with status 503"):
        deactivate_deployment(
            Settings(BASETEN_API_KEY="test-key"),
            deployment=_deployment(),
        )
