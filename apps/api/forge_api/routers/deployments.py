from fastapi import APIRouter, Depends, HTTPException

from forge_api.dependencies import get_repository
from forge_api.models.requests import CreateDeploymentRequest, DeploymentInvokeRequest
from forge_api.providers.baseten_client import chat_completion, predict_deployment
from forge_api.providers.health import get_provider_health
from forge_api.services.store import StateRepository

router = APIRouter(tags=["deployments"])


@router.get("/v1/deployments")
def get_deployments(repository: StateRepository = Depends(get_repository)) -> dict[str, object]:
    return {"deployments": [deployment.model_dump() for deployment in repository.read().deployments]}


@router.post("/v1/deployments")
@router.post("/api/deployments")
def create_deployment(
    body: CreateDeploymentRequest,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    if body.target == "modal":
        raise HTTPException(
            status_code=422,
            detail=(
                "Dedicated Modal serving endpoints are not supported yet. "
                "Modal training functions scale to zero when idle; delete the saved "
                "model to remove its persistent Modal checkpoint storage."
            ),
        )
    if repository.identity.authenticated:
        health = get_provider_health(repository.settings)
        if body.target == "baseten" and (
            health.baseten != "configured" or health.modal != "configured"
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Configure both Modal and Baseten credentials in Account "
                    "before deploying."
                ),
            )
    try:
        return _dump(repository.deploy_checkpoint(body.checkpointId, body.target))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Deployment failed: {exc}") from exc


@router.post("/v1/deployments/{deployment_id}/invoke")
def invoke_deployment(
    deployment_id: str,
    body: DeploymentInvokeRequest,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    state = repository.read()
    deployment = next((item for item in state.deployments if item.id == deployment_id), None)
    if deployment is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if deployment.status in {"paused", "stopped"}:
        raise HTTPException(status_code=409, detail="Deployment is paused")
    if (
        repository.identity.authenticated
        and getattr(get_provider_health(repository.settings), deployment.target)
        != "configured"
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Configure {deployment.target.title()} credentials in Account "
                "before invoking this deployment."
            ),
        )
    prompt = body.prompt
    if prompt is None and body.messages:
        prompt = "\n".join(f"{message.role}: {message.content}" for message in body.messages)
    prompt = prompt or "Hello"
    if deployment.target == "baseten" and get_provider_health(repository.settings).baseten == "configured":
        try:
            if deployment.providerModelId and deployment.endpointUrl:
                return predict_deployment(repository.settings, deployment=deployment, prompt=prompt, messages=body.messages)
            return chat_completion(repository.settings, prompt=prompt, messages=body.messages)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Baseten invoke failed: {exc}") from exc

    return {
        "id": f"chatcmpl-{deployment.id}",
        "object": "chat.completion",
        "model": deployment.checkpointId,
        "provider_mode": deployment.mode,
        "endpoint": deployment.endpointUrl,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": f"Local deployment fallback response for: {prompt}"},
                "finish_reason": "stop",
            }
        ],
    }


@router.post("/v1/deployments/{deployment_id}/stop")
@router.post("/api/deployments/{deployment_id}/stop")
def stop_deployment(
    deployment_id: str,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    try:
        return _dump(repository.stop_deployment(deployment_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Stop deployment failed: {exc}") from exc


@router.post("/v1/deployments/{deployment_id}/start")
@router.post("/api/deployments/{deployment_id}/start")
def start_deployment(
    deployment_id: str,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    try:
        return _dump(repository.start_deployment(deployment_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Start deployment failed: {exc}") from exc


@router.delete("/v1/deployments/{deployment_id}")
@router.post("/v1/deployments/{deployment_id}/delete")
@router.post("/api/deployments/{deployment_id}/delete")
def delete_deployment(
    deployment_id: str,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    try:
        return _dump(repository.delete_deployment(deployment_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Delete deployment failed: {exc}") from exc


def _dump(result: dict[str, object]) -> dict[str, object]:
    return {key: value.model_dump() if hasattr(value, "model_dump") else value for key, value in result.items()}
