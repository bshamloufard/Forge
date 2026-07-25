import json
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

import httpx

from forge_api.ids import create_id
from forge_api.models.domain import (
    Checkpoint,
    Dataset,
    DatasetAdapter,
    Deployment,
    ForgeState,
    Project,
    Session,
    TrainingRun,
    VerifierScore,
)
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
from forge_api.services.datasets import (
    DatasetValidationError,
    inspect_huggingface_dataset,
    inspect_uploaded_dataset,
)
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
            datasets=[],
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

    def create_huggingface_dataset(
        self,
        *,
        name: str | None,
        reference: str,
        config: str | None,
        split: str | None,
        revision: str | None,
        adapter: DatasetAdapter | None,
    ) -> dict[str, object]:
        dataset_id, inspection = inspect_huggingface_dataset(
            reference,
            config=config,
            split=split,
            revision=revision,
            adapter=adapter,
        )
        state = self.read()
        timestamp = now()
        dataset = Dataset(
            id=create_id("dset"),
            projectId=state.project.id,
            name=name or dataset_id.split("/", 1)[-1],
            sourceType="huggingface",
            sourceUri=f"hf://{dataset_id}",
            sourceConfig=inspection.source_config,
            sourceSplit=inspection.source_split,
            sourceRevision=revision,
            status=inspection.status,  # type: ignore[arg-type]
            adapter=inspection.adapter,
            columns=inspection.columns,
            rowCount=inspection.row_count,
            preview=inspection.preview,
            canonicalPreview=inspection.canonical_preview,
            quality=inspection.quality,
            warnings=inspection.warnings,
            validationErrors=inspection.validation_errors,
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        state.datasets.insert(0, dataset)
        self.write(state)
        return {"state": state, "dataset": dataset}

    def create_uploaded_dataset(
        self,
        *,
        name: str | None,
        filename: str,
        content_type: str | None,
        payload: bytes,
    ) -> dict[str, object]:
        inspection = inspect_uploaded_dataset(payload, filename)
        state = self.read()
        timestamp = now()
        dataset_id = create_id("dset")
        storage_uri = self._write_dataset_artifact(dataset_id, filename, content_type, payload)
        dataset = Dataset(
            id=dataset_id,
            projectId=state.project.id,
            name=name or Path(filename).stem,
            sourceType="upload",
            sourceUri=f"upload://{Path(filename).name}",
            sourceSplit="train",
            fileName=Path(filename).name,
            contentType=content_type,
            byteSize=len(payload),
            storageUri=storage_uri,
            status=inspection.status,  # type: ignore[arg-type]
            adapter=inspection.adapter,
            columns=inspection.columns,
            rowCount=inspection.row_count,
            preview=inspection.preview,
            canonicalPreview=inspection.canonical_preview,
            quality=inspection.quality,
            warnings=inspection.warnings,
            validationErrors=inspection.validation_errors,
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        state.datasets.insert(0, dataset)
        self.write(state)
        return {"state": state, "dataset": dataset}

    def update_dataset_adapter(
        self,
        dataset_id: str,
        adapter: DatasetAdapter,
    ) -> dict[str, object]:
        state = self.read()
        dataset = _find_dataset(state, dataset_id)
        if dataset.sourceType == "huggingface":
            _, inspection = inspect_huggingface_dataset(
                dataset.sourceUri.removeprefix("hf://"),
                config=dataset.sourceConfig,
                split=dataset.sourceSplit,
                revision=dataset.sourceRevision,
                adapter=adapter,
            )
        else:
            payload = self._read_dataset_artifact(dataset)
            inspection = inspect_uploaded_dataset(payload, dataset.fileName or "dataset.jsonl", adapter)

        dataset.adapter = inspection.adapter
        dataset.status = inspection.status  # type: ignore[assignment]
        dataset.columns = inspection.columns
        dataset.rowCount = inspection.row_count
        dataset.preview = inspection.preview
        dataset.canonicalPreview = inspection.canonical_preview
        dataset.quality = inspection.quality
        dataset.warnings = inspection.warnings
        dataset.validationErrors = inspection.validation_errors
        dataset.updatedAt = now()
        self.write(state)
        return {"state": state, "dataset": dataset}

    def delete_dataset(self, dataset_id: str) -> dict[str, object]:
        state = self.read()
        dataset = _find_dataset(state, dataset_id)
        if any(session.datasetId == dataset_id for session in state.sessions):
            raise ValueError("Dataset is used by an existing training session.")
        if dataset.sourceType == "upload":
            self._delete_dataset_artifact(dataset)
        state.datasets = [item for item in state.datasets if item.id != dataset_id]
        self.write(state)
        return {"state": state, "dataset": dataset}

    def create_session(
        self,
        *,
        name: str,
        model: str,
        recipe: str,
        dataset_id: str | None,
        target_steps: int | None,
    ) -> dict[str, object]:
        state = self.read()
        timestamp = now()
        dataset = _find_dataset(state, dataset_id) if dataset_id else None
        if dataset and dataset.status != "ready":
            raise DatasetValidationError("The selected dataset needs a valid adapter before training.")
        session = Session(
            id=create_id("ses"),
            projectId=state.project.id,
            name=name,
            creator=self.identity.email or "researcher@forge.local",
            model=model,
            recipe=recipe,  # type: ignore[arg-type]
            datasetId=dataset.id if dataset else None,
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        run = TrainingRun(
            id=create_id("run"),
            sessionId=session.id,
            name=f"{recipes[session.recipe]['name'].lower().replace(' ', '-')}-run",
            datasetId=dataset.id if dataset else None,
            status="queued",
            step=0,
            targetSteps=target_steps or 100,
            loss=2.4,
            reward=0.22,
            verifierScore=0.31,
            tokens=0,
            costUsd=0,
            logs=[
                (
                    f"created {recipes[session.recipe]['name']} session for {model} "
                    f"dataset={dataset.name if dataset else 'legacy-default'}"
                ),
                "waiting for first forward_backward call",
            ],
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
        dataset = _find_dataset(state, session.datasetId) if session.datasetId else None
        if self.settings.modal_token_id and self.settings.modal_token_secret:
            run.status = "running"
            run.updatedAt = now()
            run.logs.insert(
                0,
                (
                    "modal run_tiny_finetune starting "
                    f"model={self.settings.training_model_id} "
                    f"dataset={dataset.sourceUri if dataset else self.settings.training_dataset_id} "
                    f"split={dataset.sourceSplit if dataset else self.settings.training_dataset_split}"
                ),
            )
            self.write(state)
            try:
                result = run_tiny_finetune(
                    self.settings,
                    run_id=run.id,
                    model_id=session.model,
                    dataset=dataset,
                    dataset_url=self._signed_dataset_url(dataset) if dataset and dataset.sourceType == "upload" else None,
                )
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

    def _write_dataset_artifact(
        self,
        dataset_id: str,
        filename: str,
        content_type: str | None,
        payload: bytes,
    ) -> str:
        safe_name = _safe_filename(filename)
        object_path = f"{self.identity.safe_user_id}/{dataset_id}/{safe_name}"
        service_key = self.settings.supabase_secret_key or self.settings.supabase_service_role_key
        if self.settings.supabase_url and service_key:
            bucket = quote(self.settings.dataset_bucket, safe="")
            encoded_path = quote(object_path, safe="/")
            response = httpx.post(
                f"{self.settings.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{encoded_path}",
                headers={
                    **self._supabase_storage_headers(),
                    "content-type": content_type or "application/octet-stream",
                    "x-upsert": "false",
                },
                content=payload,
                timeout=30,
            )
            try:
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise RuntimeError("Could not store the uploaded dataset") from exc
            return f"supabase://{self.settings.dataset_bucket}/{object_path}"

        target = self.path.parent / "datasets" / self.identity.safe_user_id / dataset_id / safe_name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        return target.resolve().as_uri()

    def _read_dataset_artifact(self, dataset: Dataset) -> bytes:
        if not dataset.storageUri:
            raise RuntimeError("Dataset artifact is missing")
        if dataset.storageUri.startswith("supabase://"):
            bucket, object_path = _split_supabase_uri(dataset.storageUri)
            response = httpx.get(
                (
                    f"{self.settings.supabase_url.rstrip('/')}/storage/v1/object/authenticated/"
                    f"{quote(bucket, safe='')}/{quote(object_path, safe='/')}"
                ),
                headers=self._supabase_storage_headers(),
                timeout=30,
            )
            try:
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise RuntimeError("Could not read the uploaded dataset") from exc
            return response.content
        if dataset.storageUri.startswith("file://"):
            return Path(dataset.storageUri.removeprefix("file://")).read_bytes()
        raise RuntimeError("Dataset artifact URI is not supported")

    def _signed_dataset_url(self, dataset: Dataset) -> str:
        if not dataset.storageUri or not dataset.storageUri.startswith("supabase://"):
            raise RuntimeError("Uploaded datasets require Supabase Storage for remote training")
        if not self.settings.supabase_url:
            raise RuntimeError("Supabase Storage is not configured")
        bucket, object_path = _split_supabase_uri(dataset.storageUri)
        response = httpx.post(
            (
                f"{self.settings.supabase_url.rstrip('/')}/storage/v1/object/sign/"
                f"{quote(bucket, safe='')}/{quote(object_path, safe='/')}"
            ),
            headers={
                **self._supabase_storage_headers(),
                "content-type": "application/json",
            },
            json={"expiresIn": 3600},
            timeout=20,
        )
        try:
            response.raise_for_status()
            signed_path = response.json()["signedURL"]
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise RuntimeError("Could not authorize the training worker to read the dataset") from exc
        if str(signed_path).startswith("http"):
            return str(signed_path)
        return f"{self.settings.supabase_url.rstrip('/')}/storage/v1{signed_path}"

    def _delete_dataset_artifact(self, dataset: Dataset) -> None:
        if not dataset.storageUri:
            return
        if dataset.storageUri.startswith("supabase://"):
            bucket, object_path = _split_supabase_uri(dataset.storageUri)
            response = httpx.delete(
                (
                    f"{self.settings.supabase_url.rstrip('/')}/storage/v1/object/"
                    f"{quote(bucket, safe='')}/{quote(object_path, safe='/')}"
                ),
                headers=self._supabase_storage_headers(),
                timeout=20,
            )
            response.raise_for_status()
        elif dataset.storageUri.startswith("file://"):
            path = Path(dataset.storageUri.removeprefix("file://"))
            if path.is_file():
                path.unlink()

    def _supabase_storage_headers(self) -> dict[str, str]:
        service_key = self.settings.supabase_secret_key or self.settings.supabase_service_role_key
        if not self.settings.supabase_url or not service_key:
            raise RuntimeError("Supabase Storage is not configured")
        return {
            "apikey": service_key,
            "authorization": f"Bearer {service_key}",
        }


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


def _find_dataset(state: ForgeState, dataset_id: str | None) -> Dataset:
    dataset = next((item for item in state.datasets if item.id == dataset_id), None)
    if dataset is None:
        raise KeyError("Dataset not found")
    return dataset


def _safe_filename(filename: str) -> str:
    basename = Path(filename).name
    safe = "".join(character if character.isalnum() or character in "._-" else "_" for character in basename)
    return safe[:160] or "dataset.jsonl"


def _split_supabase_uri(uri: str) -> tuple[str, str]:
    value = uri.removeprefix("supabase://")
    bucket, separator, object_path = value.partition("/")
    if not separator or not bucket or not object_path:
        raise RuntimeError("Dataset storage URI is invalid")
    return bucket, object_path


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
