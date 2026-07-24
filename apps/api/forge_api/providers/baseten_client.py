from __future__ import annotations

from typing import Any

import httpx

from forge_api.models.domain import Deployment
from forge_api.models.requests import Message
from forge_api.settings import Settings


def chat_completion(settings: Settings, *, prompt: str, messages: list[Message] | None = None) -> dict[str, Any]:
    if not settings.baseten_api_key:
        raise RuntimeError("BASETEN_API_KEY is not configured")

    payload_messages = [
        {"role": message.role, "content": message.content}
        for message in messages
    ] if messages else [{"role": "user", "content": prompt}]

    model = settings.baseten_default_model or settings.baseten_model_id
    response = httpx.post(
        f"{settings.baseten_base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.baseten_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": payload_messages,
            "temperature": 0,
            "max_tokens": 160,
        },
        timeout=60,
    )
    response.raise_for_status()
    data = response.json()
    data["provider_mode"] = "configured"
    data["endpoint"] = settings.baseten_base_url
    return data


def predict_deployment(
    settings: Settings,
    *,
    deployment: Deployment,
    prompt: str,
    messages: list[Message] | None = None,
) -> dict[str, Any]:
    if not settings.baseten_api_key:
        raise RuntimeError("BASETEN_API_KEY is not configured")

    payload: dict[str, Any] = {
        "prompt": prompt,
        "max_tokens": 64,
    }
    if messages:
        payload["messages"] = [{"role": message.role, "content": message.content} for message in messages]

    response = httpx.post(
        deployment.endpointUrl,
        headers={
            "Authorization": f"Bearer {settings.baseten_api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict) and "choices" in data:
        data["provider_mode"] = deployment.mode
        data["endpoint"] = deployment.endpointUrl
        data["provider_model_id"] = deployment.providerModelId
        data["provider_deployment_id"] = deployment.providerDeploymentId
        return data

    return {
        "id": f"chatcmpl-{deployment.id}",
        "object": "chat.completion",
        "model": deployment.providerModelId or deployment.checkpointId,
        "provider_mode": deployment.mode,
        "endpoint": deployment.endpointUrl,
        "provider_model_id": deployment.providerModelId,
        "provider_deployment_id": deployment.providerDeploymentId,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": str(data.get("output", data)) if isinstance(data, dict) else str(data)},
                "finish_reason": "stop",
            }
        ],
    }
