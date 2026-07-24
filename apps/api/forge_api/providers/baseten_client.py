from __future__ import annotations

from typing import Any

import httpx

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
