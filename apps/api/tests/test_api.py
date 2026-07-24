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


def test_baseten_deployment_uses_checkpoint_artifact(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("FORGE_STATE_PATH", str(tmp_path / "baseten-state.json"))
    monkeypatch.setenv("MODAL_TOKEN_ID", "modal-token-id")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "modal-token-secret")
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-api-key")
    get_settings.cache_clear()

    def fake_deploy(settings, *, checkpoint):
        return {
            "model_id": "model-custom",
            "deployment_id": "deployment-custom",
            "deployment_status": "active",
            "deployment_name": "forge-custom",
            "predict_url": "https://model-custom.api.baseten.co/environments/production/predict",
            "logs_url": "https://app.baseten.co/models/model-custom/logs",
        }

    def fake_predict(settings, *, deployment, prompt, messages=None):
        return {
            "id": "chatcmpl-custom",
            "object": "chat.completion",
            "model": deployment.providerModelId,
            "endpoint": deployment.endpointUrl,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": f"custom deployment saw {prompt}"},
                    "finish_reason": "stop",
                }
            ],
        }

    def fake_deactivate(settings, *, deployment):
        return {"model_id": deployment.providerModelId, "deployment_id": deployment.providerDeploymentId}

    def fake_delete_baseten(settings, *, deployment):
        return {"model_id": deployment.providerModelId}

    def fake_delete_artifact(settings, *, artifact_uri):
        return {"artifact_uri": artifact_uri, "deleted": True}

    monkeypatch.setattr("forge_api.services.store.deploy_checkpoint_to_baseten", fake_deploy)
    monkeypatch.setattr("forge_api.services.store.deactivate_baseten_deployment", fake_deactivate)
    monkeypatch.setattr("forge_api.services.store.delete_baseten_model", fake_delete_baseten)
    monkeypatch.setattr("forge_api.services.store.delete_checkpoint_artifact", fake_delete_artifact)
    monkeypatch.setattr("forge_api.routers.deployments.predict_deployment", fake_predict)

    client = TestClient(app)
    created = client.post(
        "/v1/sessions",
        json={"name": "baseten artifact", "model": "sshleifer/tiny-gpt2", "recipe": "chat-sft", "targetSteps": 2},
    )
    assert created.status_code == 200
    run_id = created.json()["run"]["id"]

    checkpoint = client.post("/v1/checkpoints", json={"runId": run_id, "name": "artifact-checkpoint"})
    assert checkpoint.status_code == 200
    checkpoint_id = checkpoint.json()["checkpoint"]["id"]

    deployed = client.post("/v1/deployments", json={"checkpointId": checkpoint_id, "target": "baseten"})
    assert deployed.status_code == 200
    deployment = deployed.json()["deployment"]
    assert deployment["endpointUrl"] == "https://model-custom.api.baseten.co/environments/production/predict"
    assert deployment["artifactUri"] == f"modal-volume://forge-checkpoints/{run_id}"
    assert deployment["providerModelId"] == "model-custom"
    assert deployment["providerDeploymentId"] == "deployment-custom"
    assert deployment["status"] == "live"

    invoked = client.post(f"/v1/deployments/{deployment['id']}/invoke", json={"prompt": "Hello custom"})
    assert invoked.status_code == 200
    assert invoked.json()["model"] == "model-custom"
    assert invoked.json()["choices"][0]["message"]["content"] == "custom deployment saw Hello custom"

    stopped = client.post(f"/v1/deployments/{deployment['id']}/stop", json={})
    assert stopped.status_code == 200
    assert stopped.json()["deployment"]["status"] == "stopped"

    reinvoked = client.post(f"/v1/deployments/{deployment['id']}/invoke", json={"prompt": "Hello custom"})
    assert reinvoked.status_code == 409

    deleted_deployment = client.post(f"/v1/deployments/{deployment['id']}/delete", json={})
    assert deleted_deployment.status_code == 200
    assert deleted_deployment.json()["deployment"]["id"] == deployment["id"]
    assert client.get("/v1/deployments").json()["deployments"] == []

    deleted_checkpoint = client.post(f"/v1/checkpoints/{checkpoint_id}/delete", json={})
    assert deleted_checkpoint.status_code == 200
    assert deleted_checkpoint.json()["checkpoint"]["id"] == checkpoint_id
    assert client.get("/v1/checkpoints").json()["checkpoints"] == []


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
