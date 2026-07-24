from __future__ import annotations

from typing import Any

from forge_api.models.domain import Checkpoint, Deployment
from forge_api.settings import Settings


def run_tiny_finetune(settings: Settings, *, run_id: str) -> dict[str, Any]:
    import modal

    with _modal_client(modal, settings) as client:
        function = modal.Function.from_name(
            settings.modal_app_name,
            "run_tiny_finetune",
            environment_name=settings.modal_environment,
            client=client,
        )
        return function.remote(
            run_id=run_id,
            model_id=settings.training_model_id,
            dataset_id=settings.training_dataset_id,
            dataset_split=settings.training_dataset_split,
            max_steps=settings.training_max_steps,
        )


def deploy_checkpoint_to_baseten(settings: Settings, *, checkpoint: Checkpoint) -> dict[str, Any]:
    if not settings.baseten_api_key:
        raise RuntimeError("BASETEN_API_KEY is not configured")

    run_id = _run_id_from_artifact_uri(checkpoint.artifactUri) or checkpoint.runId
    import modal

    with _modal_client(modal, settings) as client:
        function = modal.Function.from_name(
            settings.modal_app_name,
            "deploy_checkpoint_to_baseten",
            environment_name=settings.modal_environment,
            client=client,
        )
        return function.remote(
            run_id=run_id,
            checkpoint_id=checkpoint.id,
            checkpoint_name=checkpoint.name,
            baseten_api_key=settings.baseten_api_key,
            wait_for_live=settings.baseten_deployment_wait,
        )


def deactivate_baseten_deployment(settings: Settings, *, deployment: Deployment) -> dict[str, Any]:
    if not settings.baseten_api_key:
        raise RuntimeError("BASETEN_API_KEY is not configured")
    if not deployment.providerModelId or not deployment.providerDeploymentId:
        raise RuntimeError("Deployment does not have Baseten provider ids")

    import modal

    with _modal_client(modal, settings) as client:
        function = modal.Function.from_name(
            settings.modal_app_name,
            "deactivate_baseten_deployment",
            environment_name=settings.modal_environment,
            client=client,
        )
        return function.remote(
            model_id=deployment.providerModelId,
            deployment_id=deployment.providerDeploymentId,
            baseten_api_key=settings.baseten_api_key,
        )


def delete_baseten_model(settings: Settings, *, deployment: Deployment) -> dict[str, Any]:
    if not settings.baseten_api_key:
        raise RuntimeError("BASETEN_API_KEY is not configured")
    if not deployment.providerModelId:
        raise RuntimeError("Deployment does not have a Baseten model id")

    import modal

    with _modal_client(modal, settings) as client:
        function = modal.Function.from_name(
            settings.modal_app_name,
            "delete_baseten_model",
            environment_name=settings.modal_environment,
            client=client,
        )
        return function.remote(
            model_id=deployment.providerModelId,
            baseten_api_key=settings.baseten_api_key,
        )


def delete_checkpoint_artifact(settings: Settings, *, artifact_uri: str) -> dict[str, Any]:
    run_id = _run_id_from_artifact_uri(artifact_uri)
    if not run_id:
        return {"deleted": False, "reason": "unsupported artifact URI"}

    import modal

    with _modal_client(modal, settings) as client:
        function = modal.Function.from_name(
            settings.modal_app_name,
            "delete_checkpoint_artifact",
            environment_name=settings.modal_environment,
            client=client,
        )
        return function.remote(run_id=run_id)


def _modal_client(modal: Any, settings: Settings) -> Any:
    if not settings.modal_token_id or not settings.modal_token_secret:
        raise RuntimeError("Modal credentials are not configured")
    return modal.Client.from_credentials(
        settings.modal_token_id,
        settings.modal_token_secret,
    )


def _run_id_from_artifact_uri(artifact_uri: str) -> str | None:
    prefix = "modal-volume://forge-checkpoints/"
    if artifact_uri.startswith(prefix):
        return artifact_uri.removeprefix(prefix).strip("/") or None
    return None
