from pathlib import Path

from fastapi.testclient import TestClient

from forge_api.main import app
from forge_api.settings import get_settings


def test_training_checkpoint_sampling_verifier_deployment_flow(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("FORGE_STATE_PATH", str(tmp_path / "state.json"))
    _disable_provider_env(monkeypatch)
    get_settings.cache_clear()

    client = TestClient(app)

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["service"] == "forge-api"

    created = client.post(
        "/v1/sessions",
        json={"name": "pytest run", "model": "sshleifer/tiny-gpt2", "recipe": "chat-sft", "targetSteps": 8},
    )
    assert created.status_code == 200
    run_id = created.json()["run"]["id"]

    stepped = client.post(f"/v1/training-runs/{run_id}/forward-backward", json={"microbatches": 2})
    assert stepped.status_code == 200
    assert stepped.json()["run"]["step"] == 2

    optimized = client.post(f"/v1/training-runs/{run_id}/optim-step", json={})
    assert optimized.status_code == 200
    assert optimized.json()["run"]["loss"] < stepped.json()["run"]["loss"]

    checkpoint = client.post("/v1/checkpoints", json={"runId": run_id, "name": "pytest-step"})
    assert checkpoint.status_code == 200
    checkpoint_id = checkpoint.json()["checkpoint"]["id"]

    sample = client.post("/v1/sampling-jobs", json={"sessionId": created.json()["session"]["id"], "prompt": "Test prompt"})
    assert sample.status_code == 200
    assert "Test prompt" in sample.json()["output"]

    verified = client.post(
        "/v1/verifier/verify",
        json={"candidate": "The answer is correct because it verifies the result against tests.", "rubric": "correct verified"},
    )
    assert verified.status_code == 200
    assert verified.json()["score"] > 0.5

    deployed = client.post("/v1/deployments", json={"checkpointId": checkpoint_id, "target": "baseten"})
    assert deployed.status_code == 200
    deployment_id = deployed.json()["deployment"]["id"]

    invoked = client.post(f"/v1/deployments/{deployment_id}/invoke", json={"prompt": "Hello"})
    assert invoked.status_code == 200
    assert invoked.json()["choices"][0]["message"]["role"] == "assistant"


def test_legacy_dashboard_state_route(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("FORGE_STATE_PATH", str(tmp_path / "legacy-state.json"))
    _disable_provider_env(monkeypatch)
    get_settings.cache_clear()

    client = TestClient(app)
    state = client.get("/api/state")
    assert state.status_code == 200
    assert state.json()["providers"]["modal"] in {"mock", "configured"}


def _disable_provider_env(monkeypatch):
    for key in [
        "MODAL_TOKEN_ID",
        "MODAL_TOKEN_SECRET",
        "BASETEN_API_KEY",
        "SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
    ]:
        monkeypatch.setenv(key, "")
