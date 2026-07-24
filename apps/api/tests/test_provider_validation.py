from __future__ import annotations

import json
import subprocess

import httpx
import pytest
from fastapi.testclient import TestClient

from forge_api.main import app
from forge_api.providers.health import get_provider_health
from forge_api.providers.validation import (
    BASETEN_MANAGEMENT_MODELS_URL,
    ProviderValidation,
    provision_modal_worker,
    validate_baseten_api_key,
)
from forge_api.services.credentials import ProviderConfigurationSnapshot
from forge_api.settings import Settings, get_settings


class FakeResponse:
    def __init__(self, status_code: int, payload: object = None) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if isinstance(self._payload, ValueError):
            raise self._payload
        return self._payload


class FakeHttpClient:
    def __init__(self, response: FakeResponse | Exception) -> None:
        self.response = response
        self.request: dict[str, object] | None = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    def get(self, url: str, **kwargs):
        self.request = {"url": url, **kwargs}
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


@pytest.mark.parametrize(
    ("status_code", "payload", "status", "code"),
    [
        (200, {"models": []}, "ready", "baseten_ready"),
        (200, {"unexpected": []}, "unavailable", "baseten_invalid_response"),
        (200, ValueError("malformed"), "unavailable", "baseten_invalid_response"),
        (401, {"error": "unauthorized"}, "invalid", "baseten_access_denied"),
        (403, {"error": "denied"}, "invalid", "baseten_access_denied"),
        (402, {}, "invalid", "baseten_account_action_required"),
        (429, {}, "unavailable", "baseten_unavailable"),
        (503, {}, "unavailable", "baseten_unavailable"),
    ],
)
def test_baseten_validation_is_read_only_and_sanitized(
    monkeypatch,
    status_code: int,
    payload: object,
    status: str,
    code: str,
):
    fake_client = FakeHttpClient(FakeResponse(status_code, payload))
    monkeypatch.setattr(
        "forge_api.providers.validation.httpx.Client",
        lambda **kwargs: fake_client,
    )

    secret = "baseten-secret-that-must-not-leak"
    result = validate_baseten_api_key(secret)

    assert result.status == status
    assert result.code == code
    assert secret not in result.message
    assert fake_client.request is not None
    assert fake_client.request["url"] == BASETEN_MANAGEMENT_MODELS_URL
    assert fake_client.request["headers"] == {
        "Authorization": f"Bearer {secret}",
        "Accept": "application/json",
    }
    params = fake_client.request["params"]
    assert isinstance(params, dict)
    assert str(params["name"]).startswith("forge-credential-validation-")


def test_baseten_network_failure_preserves_secret(monkeypatch):
    fake_client = FakeHttpClient(httpx.ConnectError("network unavailable"))
    monkeypatch.setattr(
        "forge_api.providers.validation.httpx.Client",
        lambda **kwargs: fake_client,
    )
    result = validate_baseten_api_key("not-returned")
    assert result.status == "unavailable"
    assert "not-returned" not in result.message


def test_modal_provisioner_uses_stdin_and_strips_inherited_credentials(
    monkeypatch,
):
    captured: dict[str, object] = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured.update(kwargs)
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=(
                'FORGE_MODAL_RESULT={"status":"ready","code":"modal_ready",'
                '"message":"verified","provisioned":true}\n'
            ),
            stderr="",
        )

    monkeypatch.setattr(
        "forge_api.providers.validation.subprocess.run",
        fake_run,
    )
    monkeypatch.setenv("MODAL_TOKEN_ID", "founder-id")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "founder-secret")

    result = provision_modal_worker(
        Settings(),
        token_id="candidate-id",
        token_secret="candidate-secret",
        environment="main",
    )

    assert result.ready
    assert result.provisioned
    command = captured["command"]
    assert isinstance(command, list)
    assert "candidate-id" not in command
    assert "candidate-secret" not in command
    child_env = captured["env"]
    assert isinstance(child_env, dict)
    assert "MODAL_TOKEN_ID" not in child_env
    assert "MODAL_TOKEN_SECRET" not in child_env
    assert "SUPABASE_SECRET_KEY" not in child_env
    assert "INTERNAL_API_KEY" not in child_env
    assert child_env["MODAL_SERVER_URL"] == "https://api.modal.com"
    assert set(child_env).issubset(
        {
            "PYTHONPATH",
            "MODAL_CONFIG_PATH",
            "MODAL_SERVER_URL",
            "MODAL_LOGLEVEL",
            "PATH",
            "LANG",
            "LC_ALL",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
        }
    )
    request = json.loads(str(captured["input"]))
    assert request["action"] == "provision"
    assert request["token_id"] == "candidate-id"
    assert request["token_secret"] == "candidate-secret"


def test_modal_provisioner_never_returns_child_output(monkeypatch):
    def fake_run(command, **kwargs):
        return subprocess.CompletedProcess(
            command,
            1,
            stdout="unstructured output containing candidate-secret",
            stderr="candidate-secret",
        )

    monkeypatch.setattr(
        "forge_api.providers.validation.subprocess.run",
        fake_run,
    )
    result = provision_modal_worker(
        Settings(),
        token_id="candidate-id",
        token_secret="candidate-secret",
        environment="main",
    )
    assert result.status == "unavailable"
    assert "candidate-secret" not in result.message


def test_modal_health_requires_both_token_parts():
    assert (
        get_provider_health(
            Settings(MODAL_TOKEN_ID="id", MODAL_TOKEN_SECRET="")
        ).modal
        == "mock"
    )
    assert (
        get_provider_health(
            Settings(MODAL_TOKEN_ID="", MODAL_TOKEN_SECRET="secret")
        ).modal
        == "mock"
    )
    assert (
        get_provider_health(
            Settings(
                MODAL_TOKEN_ID="id",
                MODAL_TOKEN_SECRET="secret",
            )
        ).modal
        == "configured"
    )


def test_provider_candidate_route_skips_modal_when_baseten_fails(
    monkeypatch,
):
    monkeypatch.setenv("INTERNAL_API_KEY", "")
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    get_settings.cache_clear()
    modal_called = False
    save_called = False

    snapshot = ProviderConfigurationSnapshot(
        settings=Settings(
            MODAL_TOKEN_ID="saved-id",
            MODAL_TOKEN_SECRET="saved-secret",
        ),
        modal_generation=0,
        baseten_generation=0,
        modal_connection_state="valid",
        baseten_connection_state="missing",
        modal_worker_state="ready",
        modal_worker_revision="forge-worker-20260724.1",
    )

    def fake_baseten(api_key: str):
        assert api_key == "candidate-baseten"
        return ProviderValidation(
            status="invalid",
            code="baseten_access_denied",
            message="Baseten access denied.",
        )

    def fake_modal(*args, **kwargs):
        nonlocal modal_called
        modal_called = True
        raise AssertionError("Modal must not be mutated after Baseten fails")

    def fake_save(*args, **kwargs):
        nonlocal save_called
        save_called = True
        raise AssertionError("Invalid candidates must not be saved")

    monkeypatch.setattr(
        "forge_api.routers.providers.provider_configuration_for_setup",
        lambda *args: snapshot,
    )
    monkeypatch.setattr(
        "forge_api.routers.providers.validate_baseten_api_key",
        fake_baseten,
    )
    monkeypatch.setattr(
        "forge_api.routers.providers.provision_modal_worker",
        fake_modal,
    )
    monkeypatch.setattr(
        "forge_api.routers.providers.save_validated_provider_configuration",
        fake_save,
    )

    response = TestClient(app).post(
        "/v1/providers/configure",
        headers={
            "X-Forge-User-Id": "2c5c8d70-eeb9-4f14-af06-df64e5c4c083",
        },
        json={
            "baseten_api_key": "candidate-baseten",
            "modal_token_id": "candidate-id",
            "modal_token_secret": "candidate-secret",
        },
    )

    assert response.status_code == 400
    assert "candidate-baseten" not in response.text
    assert "candidate-secret" not in response.text
    assert modal_called is False
    assert save_called is False


def test_provider_candidate_route_requires_modal_pair(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "")
    get_settings.cache_clear()
    response = TestClient(app).post(
        "/v1/providers/configure",
        headers={
            "X-Forge-User-Id": "2c5c8d70-eeb9-4f14-af06-df64e5c4c083",
        },
        json={"modal_token_id": "candidate-id"},
    )
    assert response.status_code == 400
    assert "candidate-id" not in response.text


def test_provider_candidate_route_rejects_control_characters_without_echo(
    monkeypatch,
):
    monkeypatch.setenv("INTERNAL_API_KEY", "")
    get_settings.cache_clear()
    secret = "candidate\r\ninjected"
    response = TestClient(app).post(
        "/v1/providers/configure",
        headers={
            "X-Forge-User-Id": "2c5c8d70-eeb9-4f14-af06-df64e5c4c083",
        },
        json={"baseten_api_key": secret},
    )
    assert response.status_code == 400
    assert "candidate" not in response.text
    assert "injected" not in response.text


def test_modal_workspace_changes_only_after_generation_checked_save(
    monkeypatch,
):
    monkeypatch.setenv("INTERNAL_API_KEY", "")
    get_settings.cache_clear()
    events: list[str] = []
    lease_ids: list[str] = []
    snapshot = ProviderConfigurationSnapshot(
        settings=Settings(
            MODAL_TOKEN_ID="saved-id",
            MODAL_TOKEN_SECRET="saved-secret",
            MODAL_ENVIRONMENT="main",
        ),
        modal_generation=4,
        baseten_generation=2,
        modal_connection_state="valid",
        baseten_connection_state="valid",
        modal_worker_state="ready",
        modal_worker_revision="old-revision",
    )

    monkeypatch.setattr(
        "forge_api.routers.providers.provider_configuration_for_setup",
        lambda *args: snapshot,
    )

    def fake_validate(*args, **kwargs):
        events.append("validate")
        return ProviderValidation(
            status="ready",
            code="modal_credentials_valid",
            message="verified",
        )

    def fake_save(*args, **kwargs):
        events.append("save")
        assert args[2].modal_generation == 4
        return (5, 2)

    def fake_begin(*args, **kwargs):
        events.append("begin")
        assert kwargs["generation"] == 5
        assert kwargs["lease_id"]
        lease_ids.append(kwargs["lease_id"])
        return True

    def fake_provision(*args, **kwargs):
        events.append("provision")
        return ProviderValidation(
            status="ready",
            code="modal_ready",
            message="installed",
            provisioned=True,
        )

    def fake_finish(*args, **kwargs):
        events.append("finish")
        assert kwargs["generation"] == 5
        assert kwargs["lease_id"]
        assert kwargs["lease_id"] == lease_ids[0]
        assert kwargs["ready"] is True
        return True

    monkeypatch.setattr(
        "forge_api.routers.providers.validate_modal_credentials",
        fake_validate,
    )
    monkeypatch.setattr(
        "forge_api.routers.providers.save_validated_provider_configuration",
        fake_save,
    )
    monkeypatch.setattr(
        "forge_api.routers.providers.begin_modal_provisioning",
        fake_begin,
    )
    monkeypatch.setattr(
        "forge_api.routers.providers.provision_modal_worker",
        fake_provision,
    )
    monkeypatch.setattr(
        "forge_api.routers.providers.finish_modal_provisioning",
        fake_finish,
    )

    response = TestClient(app).post(
        "/v1/providers/configure",
        headers={
            "X-Forge-User-Id": "2c5c8d70-eeb9-4f14-af06-df64e5c4c083",
        },
        json={
            "modal_token_id": "candidate-id",
            "modal_token_secret": "candidate-secret",
            "modal_environment": "main",
        },
    )
    assert response.status_code == 200
    assert response.json()["saved"] is True
    assert events == ["validate", "save", "begin", "provision", "finish"]
