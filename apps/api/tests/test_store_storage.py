from __future__ import annotations

import json

import httpx
import pytest

from forge_api.services.credentials import RequestIdentity
from forge_api.services.store import StateRepository
from forge_api.settings import Settings


USER_ID = "4046343e-cd03-494e-bcf9-8695f045cbb9"


def response(status_code: int, payload: object, *, method: str) -> httpx.Response:
    return httpx.Response(
        status_code,
        json=payload,
        request=httpx.Request(method, "https://example.supabase.co/storage"),
    )


@pytest.mark.parametrize(
    ("status_code", "payload"),
    [
        (404, {"message": "Not found"}),
        (
            400,
            {
                "statusCode": "404",
                "error": "not_found",
                "message": "Object not found",
            },
        ),
    ],
)
def test_missing_storage_object_initializes_user_state(
    monkeypatch,
    status_code: int,
    payload: object,
):
    writes: list[dict[str, object]] = []

    monkeypatch.setattr(
        httpx,
        "get",
        lambda *args, **kwargs: response(status_code, payload, method="GET"),
    )

    def write_state(url: str, **kwargs):
        writes.append({"url": url, **kwargs})
        return response(200, {"Key": "forge-state.json"}, method="POST")

    monkeypatch.setattr(httpx, "post", write_state)
    repository = StateRepository(
        Settings(
            APP_ENV="production",
            SUPABASE_URL="https://example.supabase.co",
            SUPABASE_SECRET_KEY="sb_secret_test",
        ),
        RequestIdentity(
            user_id=USER_ID,
            email="new-user@example.com",
            authenticated=True,
        ),
    )

    state = repository.read()

    assert state.project.organization == "new-user@example.com"
    assert len(writes) == 1
    assert writes[0]["url"] == (
        "https://example.supabase.co/storage/v1/object/checkpoints/"
        f"user-state/{USER_ID}/forge-state.json"
    )
    assert json.loads(writes[0]["content"])["project"]["organization"] == (
        "new-user@example.com"
    )


def test_unexpected_storage_error_does_not_overwrite_user_state(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *args, **kwargs: response(
            400,
            {"statusCode": "400", "error": "invalid_request"},
            method="GET",
        ),
    )
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: pytest.fail("unexpected state overwrite"),
    )
    repository = StateRepository(
        Settings(
            APP_ENV="production",
            SUPABASE_URL="https://example.supabase.co",
            SUPABASE_SECRET_KEY="sb_secret_test",
        ),
        RequestIdentity(user_id=USER_ID, authenticated=True),
    )

    with pytest.raises(
        RuntimeError,
        match="Could not read the authenticated user's Forge state",
    ):
        repository.read()
