import json
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

import httpx

from forge_api.ids import create_id
from forge_api.models.domain import Checkpoint, Deployment, ForgeState, Project, Session, TrainingRun, VerifierScore
from forge_api.providers.health import create_serving_endpoint
from forge_api.providers.health import get_provider_health
from forge_api.providers.modal_client import (
    deactivate_baseten_deployment,
    delete_baseten_model,
    delete_checkpoint_artifact,
    deploy_checkpoint_to_baseten,
    run_tiny_finetune,
)
from forge_api.recipes import recipes
from forge_api.services.credentials import RequestIdentity
from forge_api.services.verifier import score_candidate
from forge_api.settings import Settings


def now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _storage_object_is_missing(response: httpx.Response) -> bool:
    if response.status_code == 404:
        return True
    if response.status_code != 400:
        return False
    try:
        payload = response.json()
    except ValueError:
        return False
    return (
        isinstance(payload, dict)
        and str(payload.get("statusCode")) == "404"
        and payload.get("error") == "not_found"
    )


class StateRepository:
    def __init__(self, settings: Settings, identity: RequestIdentity | None = None):
        self.settings = settings
        self.identity = identity or RequestIdentity(user_id="local-default")
        self.path = _resolve_path(settings, self.identity)
        has_supabase_storage = bool(
            settings.supabase_url
            and (settings.supabase_secret_key or settings.supabase_service_role_key)
        )
        self.storage_object_path = (
            f"user-state/{self.identity.safe_user_id}/forge-state.json"
            if self.identity.authenticated
            and (has_supabase_storage or settings.app_env.strip().lower() == "production")
            else None
        )

    def read(self) -> ForgeState:
        if self.storage_object_path:
            return self._read_from_supabase()
        try:
            return ForgeState.model_validate(json.loads(self.path.read_text()))
        except FileNotFoundError:
            state = self.initial_state()
            self.write(state)
            return state
        except (OSError, ValueError) as exc:
            raise RuntimeError("Could not read the local Forge state") from exc

    def write(self, state: ForgeState) -> None:
        if self.storage_object_path:
            self._write_to_supabase(state)
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(state.model_dump_json(indent=2))

    def reset(self) -> ForgeState:
        state = self.initial_state()
        self.write(state)
        return state

    def initial_state(self) -> ForgeState:
        created_at = now()
        return ForgeState(
            project=Project(
                id="proj_default",
                name="Forge Research",
                organization=self.identity.email or "Default Org",
                createdAt=created_at,
            ),
            sessions=[],
            runs=[],
            checkpoints=[],
            deployments=[],
            verifierScores=[],
        )

    def _read_from_supabase(self) -> ForgeState:
        url, headers = self._storage_request(download=True)
        response = httpx.get(url, headers=headers, timeout=20)
        if _storage_object_is_missing(response):
            state = self.initial_state()
            self._write_to_supabase(state)
            return state
        try:
            response.raise_for_status()
            return ForgeState.model_validate(response.json())
        except (httpx.HTTPError, ValueError) as exc:
            raise RuntimeError("Could not read the authenticated user's Forge state") from exc

    def _write_to_supabase(self, state: ForgeState) -> None:
        url, headers = self._storage_request()
        response = httpx.post(
            url,
            headers={
                **headers,
                "content-type": "application/json",
                "x-upsert": "true",
            },
            content=state.model_dump_json(indent=2).encode(),
            timeout=20,
        )
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise RuntimeError("Could not persist the authenticated user's Forge state") from exc

    def _storage_request(self, *, download: bool = False) -> tuple[str, dict[str, str]]:
        service_key = self.settings.supabase_secret_key or self.settings.supabase_service_role_key
        if not self.settings.supabase_url or not service_key or not self.storage_object_path:
            raise RuntimeError("Supabase Storage is not configured for authenticated state")
        bucket = quote(self.settings.artifact_bucket, safe="")
        object_path = quote(self.storage_object_path, safe="/")
        operation = "object/authenticated" if download else "object"
        url = (
            f"{self.settings.supabase_url.rstrip('/')}/storage/v1/{operation}/"
            f"{bucket}/{object_path}"
        )
        return url, {
            "apikey": service_key,
            "authorization": f"Bearer {service_key}",
        }

    def create_session(self, *, name: str, model: str, recipe: str, target_steps: int | None) -> dict[str, object]:
        state = self.read()
        timestamp = now()
        session = Session(
            id=create_id("ses"),
            projectId=state.project.id,
            name=name,
            creator=self.identity.email or "researcher@forge.local",
            model=model,
            recipe=recipe,  # type: ignore[arg-type]
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        run = TrainingRun(
            id=create_id("run"),
            sessionId=session.id,
            name=f"{recipes[session.recipe]['name'].lower().replace(' ', '-')}-run",
            status="queued",
            step=0,
            targetSteps=target_steps or 100,
            loss=2.4,
            reward=0.22,
            verifierScore=0.31,
            tokens=0,
            costUsd=0,
            logs=[f"created {recipes[session.recipe]['name']} session for {model}", "waiting for first forward_backward call"],
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        state.sessions.insert(0, session)
        state.runs.insert(0, run)
        self.write(state)
        return {"state": state, "session": session, "run": run}

    def forward_backward(self, run_id: str, microbatches: int = 4) -> dict[str, object]:
        state = self.read()
        run = _find_run(state, run_id)
        session = _find_session(state, run.sessionId)
        if self.settings.modal_token_id and self.settings.modal_token_secret:
            run.status = "running"
            run.updatedAt = now()
            run.logs.insert(
                0,
                (
                    "modal run_tiny_finetune starting "
                    f"model={self.settings.training_model_id} "
                    f"dataset={self.settings.training_dataset_id} "
                    f"split={self.settings.training_dataset_split}"
                ),
            )
            self.write(state)
            try:
                result = run_tiny_finetune(self.settings, run_id=run.id)
            except Exception:
                state = self.read()
                run = _find_run(state, run_id)
                run.status = "failed"
                run.updatedAt = now()
                run.logs.insert(0, "modal run_tiny_finetune failed")
                self.write(state)
                raise

            state = self.read()
            run = _find_run(state, run_id)
            run.status = "completed"
            run.step = min(run.targetSteps, run.step + int(result.get("steps", microbatches)))
            run.tokens += int(result.get("tokens", 0))
            run.loss = round(float(result.get("loss", run.loss)), 4)
            run.reward = round(min(0.99, max(run.reward, 0.35)), 3)
            run.verifierScore = round(min(0.99, max(run.verifierScore, 0.42)), 3)
            run.costUsd = round(run.costUsd + 0.02, 2)
            run.updatedAt = now()
            run.logs.insert(0, f"artifact_uri={result.get('artifact_uri')}")
            run.logs.insert(
                0,
                (
                    "modal run_tiny_finetune completed "
                    f"model={result.get('model_id', session.model)} "
                    f"dataset={result.get('dataset_id')} "
                    f"steps={result.get('steps')} "
                    f"loss={result.get('loss')}"
                ),
            )
            self.write(state)
            return {"state": state, "run": run, "training": result}

        run.status = "running"
        run.step = min(run.targetSteps, run.step + max(1, microbatches))
        run.tokens += microbatches * 2048
        run.loss = round(max(0.32, run.loss * (0.985 - min(0.004, microbatches / 400))), 3)
        run.reward = round(min(0.96, run.reward + 0.012 * microbatches), 3)
        run.verifierScore = round(min(0.98, run.verifierScore + 0.01 * microbatches), 3)
        run.costUsd = round(run.costUsd + microbatches * 0.18, 2)
        run.updatedAt = now()
        run.logs.insert(0, f"local forward_backward accumulated {microbatches} microbatches at step {run.step}")
        if run.step >= run.targetSteps:
            run.status = "completed"
        self.write(state)
        return {"state": state, "run": run}

    def optim_step(self, run_id: str) -> dict[str, object]:
        state = self.read()
        run = _find_run(state, run_id)
        run.status = "completed" if run.step >= run.targetSteps else "running"
        run.loss = round(max(0.28, run.loss - 0.035), 3)
        run.reward = round(min(0.99, run.reward + 0.025), 3)
        run.verifierScore = round(min(0.99, run.verifierScore + 0.018), 3)
        run.costUsd = round(run.costUsd + 0.42, 2)
        run.updatedAt = now()
        run.logs.insert(0, "optim_step recorded optimizer application for latest training artifact")
        self.write(state)
        return {"state": state, "run": run}

    def save_checkpoint(self, run_id: str, name: str | None = None) -> dict[str, object]:
        state = self.read()
        run = _find_run(state, run_id)
        checkpoint = Checkpoint(
            id=create_id("ckpt"),
            sessionId=run.sessionId,
            runId=run.id,
            name=name or f"{run.name}-step-{run.step:03d}",
            step=run.step,
            artifactUri=_latest_artifact_uri(run) or f"modal-volume://forge-checkpoints/{run.id}",
            score=run.verifierScore,
            createdAt=now(),
        )
        state.checkpoints.insert(0, checkpoint)
        run.logs.insert(0, f"save_state wrote {checkpoint.name}")
        run.updatedAt = now()
        self.write(state)
        return {"state": state, "checkpoint": checkpoint}

    def sample_from_session(self, session_id: str, prompt: str) -> dict[str, object]:
        state = self.read()
        session = next((item for item in state.sessions if item.id == session_id), None)
        if session is None:
            raise KeyError("Session not found")
        recipe = recipes[session.recipe]
        output = "\n".join(
            [
                f"Model {session.model} sampled under {recipe['name']}.",
                f"Prompt: {prompt}",
                (
                    f"Answer: {recipe['objective']} The current adapter would respond with a concise plan, "
                    "cite artifacts, and ask the verifier for a confidence score before promotion."
                ),
            ]
        )
        return {"output": output, "session": session}

    def verify_candidate(
        self,
        candidate: str,
        rubric: str | None = None,
        reference: str | None = None,
        criteria: list[dict[str, float | str]] | None = None,
    ) -> dict[str, object]:
        state = self.read()
        result = score_candidate(candidate, rubric or "", reference or "", criteria)
        verifier_score = VerifierScore(
            id=create_id("ver"),
            candidate=candidate,
            rubric=rubric or "General task correctness and evidence quality.",
            score=float(result["score"]),
            confidence=float(result["confidence"]),
            rationale=str(result["rationale"]),
            createdAt=now(),
        )
        state.verifierScores.insert(0, verifier_score)
        self.write(state)
        return {"state": state, "verifierScore": verifier_score, **result}

    def deploy_checkpoint(self, checkpoint_id: str, target: str) -> dict[str, object]:
        state = self.read()
        checkpoint = next((item for item in state.checkpoints if item.id == checkpoint_id), None)
        if checkpoint is None:
            raise KeyError("Checkpoint not found")
        health = get_provider_health(self.settings)
        provider_result: dict[str, object] = {}
        if (
            target == "baseten"
            and health.baseten == "configured"
            and health.modal == "configured"
            and checkpoint.artifactUri.startswith("modal-volume://forge-checkpoints/")
        ):
            provider_result = deploy_checkpoint_to_baseten(self.settings, checkpoint=checkpoint)

        endpoint = create_serving_endpoint(checkpoint.name, target, self.settings)
        endpoint_url = str(provider_result.get("predict_url") or endpoint["endpointUrl"])
        deployment = Deployment(
            id=create_id("dep"),
            checkpointId=checkpoint_id,
            target=target,  # type: ignore[arg-type]
            status=_deployment_status(provider_result.get("deployment_status")) if provider_result else "live",
            endpointUrl=endpoint_url,
            mode=endpoint["mode"],  # type: ignore[arg-type]
            artifactUri=checkpoint.artifactUri,
            providerModelId=_string_or_none(provider_result.get("model_id")),
            providerDeploymentId=_string_or_none(provider_result.get("deployment_id")),
            providerDeploymentName=_string_or_none(provider_result.get("deployment_name")),
            logsUrl=_string_or_none(provider_result.get("logs_url")),
            createdAt=now(),
        )
        state.deployments.insert(0, deployment)
        self.write(state)
        return {"state": state, "deployment": deployment}

    def stop_deployment(self, deployment_id: str) -> dict[str, object]:
        state = self.read()
        deployment = next((item for item in state.deployments if item.id == deployment_id), None)
        if deployment is None:
            raise KeyError("Deployment not found")

        if deployment.target == "baseten" and deployment.mode == "configured":
            deactivate_baseten_deployment(self.settings, deployment=deployment)

        deployment.status = "stopped"
        self.write(state)
        return {"state": state, "deployment": deployment}

    def delete_deployment(self, deployment_id: str) -> dict[str, object]:
        state = self.read()
        deployment = next((item for item in state.deployments if item.id == deployment_id), None)
        if deployment is None:
            raise KeyError("Deployment not found")

        self._delete_provider_deployment(deployment)
        state.deployments = [item for item in state.deployments if item.id != deployment_id]
        self.write(state)
        return {"state": state, "deployment": deployment}

    def delete_checkpoint(self, checkpoint_id: str) -> dict[str, object]:
        state = self.read()
        checkpoint = next((item for item in state.checkpoints if item.id == checkpoint_id), None)
        if checkpoint is None:
            raise KeyError("Checkpoint not found")

        deployments = [item for item in state.deployments if item.checkpointId == checkpoint_id]
        for deployment in deployments:
            self._delete_provider_deployment(deployment)

        if get_provider_health(self.settings).modal == "configured":
            delete_checkpoint_artifact(self.settings, artifact_uri=checkpoint.artifactUri)

        state.deployments = [item for item in state.deployments if item.checkpointId != checkpoint_id]
        state.checkpoints = [item for item in state.checkpoints if item.id != checkpoint_id]
        self.write(state)
        return {"state": state, "checkpoint": checkpoint, "deployments": deployments}

    def _delete_provider_deployment(self, deployment: Deployment) -> None:
        if deployment.target == "baseten" and deployment.mode == "configured" and deployment.providerModelId:
            delete_baseten_model(self.settings, deployment=deployment)


def _resolve_path(settings: Settings, identity: RequestIdentity) -> Path:
    path = settings.state_path
    resolved = path if path.is_absolute() else Path.cwd() / path
    founder_email = settings.founder_email.strip().lower()
    if not identity.authenticated or (identity.email and identity.email == founder_email):
        return resolved
    return resolved.parent / "users" / identity.safe_user_id / resolved.name


def _find_run(state: ForgeState, run_id: str) -> TrainingRun:
    run = next((item for item in state.runs if item.id == run_id), None)
    if run is None:
        raise KeyError("Run not found")
    return run


def _find_session(state: ForgeState, session_id: str) -> Session:
    session = next((item for item in state.sessions if item.id == session_id), None)
    if session is None:
        raise KeyError("Session not found")
    return session


def _string_or_none(value: object) -> str | None:
    return str(value) if value else None


def _deployment_status(value: object) -> str:
    status = str(value or "").lower()
    if status in {"active", "live", "ready", "succeeded"}:
        return "live"
    return "deploying"


def _latest_artifact_uri(run: TrainingRun) -> str | None:
    for log in run.logs:
        if log.startswith("artifact_uri="):
            value = log.split("=", 1)[1].strip()
            return value or None
    return None
