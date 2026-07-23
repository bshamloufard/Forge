from fastapi import APIRouter, Depends, HTTPException

from forge_api.dependencies import get_repository
from forge_api.models.requests import CreateDeploymentRequest, DeploymentInvokeRequest
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
    try:
        return _dump(repository.deploy_checkpoint(body.checkpointId, body.target))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
    prompt = body.prompt
    if prompt is None and body.messages:
        prompt = "\n".join(f"{message.role}: {message.content}" for message in body.messages)
    prompt = prompt or "Hello"
    return {
        "id": f"chatcmpl-{deployment.id}",
        "object": "chat.completion",
        "model": deployment.checkpointId,
        "provider_mode": deployment.mode,
        "endpoint": deployment.endpointUrl,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": f"Mock deployed adapter response for: {prompt}"},
                "finish_reason": "stop",
            }
        ],
    }


def _dump(result: dict[str, object]) -> dict[str, object]:
    return {key: value.model_dump() if hasattr(value, "model_dump") else value for key, value in result.items()}

