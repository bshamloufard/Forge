import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from forge_api.main import app
from forge_api.models.domain import DatasetAdapter
from forge_api.services.datasets import (
    DatasetValidationError,
    inspect_uploaded_dataset,
    normalize_huggingface_reference,
)
from forge_api.settings import get_settings


def test_uploaded_jsonl_infers_chat_adapter_and_quality():
    payload = b"\n".join(
        [
            b'{"messages":[{"role":"user","content":"Hi"},{"role":"assistant","content":"Hello"}]}',
            b'{"messages":[{"role":"user","content":"Bye"},{"role":"assistant","content":"Goodbye"}]}',
        ]
    )

    inspection = inspect_uploaded_dataset(payload, "chat.jsonl")

    assert inspection.status == "ready"
    assert inspection.adapter is not None
    assert inspection.adapter.format == "messages"
    assert inspection.quality.validRows == 2
    assert '"role": "assistant"' in inspection.canonical_preview[0]


def test_uploaded_custom_columns_can_be_mapped():
    payload = b"ask,say\nWhat is Forge?,A post-training control plane.\n"
    first = inspect_uploaded_dataset(payload, "custom.csv")
    assert first.status == "needs_mapping"

    mapped = inspect_uploaded_dataset(
        payload,
        "custom.csv",
        DatasetAdapter(
            format="prompt_response",
            promptField="ask",
            responseField="say",
        ),
    )
    assert mapped.status == "ready"
    assert mapped.quality.validRows == 1
    assert "What is Forge?" in mapped.canonical_preview[0]


def test_stored_preview_is_bounded_for_wide_or_large_records():
    wide_row = {f"column_{index:03d}": "value" for index in range(140)}
    wide_row["text"] = "x" * 4_000
    inspection = inspect_uploaded_dataset(
        (json.dumps(wide_row) + "\n").encode(),
        "wide.jsonl",
    )

    assert len(inspection.columns) == 128
    assert len(inspection.preview[0]) == 128
    assert len(inspection.canonical_preview[0]) == 2_000
    assert any("first 128" in warning for warning in inspection.warnings)


@pytest.mark.parametrize(
    ("reference", "expected"),
    [
        ("HuggingFaceH4/no_robots", "HuggingFaceH4/no_robots"),
        (
            "https://huggingface.co/datasets/HuggingFaceH4/no_robots",
            "HuggingFaceH4/no_robots",
        ),
    ],
)
def test_huggingface_reference_normalization(reference: str, expected: str):
    assert normalize_huggingface_reference(reference) == expected


@pytest.mark.parametrize(
    "reference",
    [
        "http://huggingface.co/datasets/org/name",
        "https://attacker.example/datasets/org/name",
        "https://user:pass@huggingface.co/datasets/org/name",
        "https://huggingface.co/models/org/name",
        "org/name/extra",
    ],
)
def test_huggingface_reference_rejects_untrusted_urls(reference: str):
    with pytest.raises(DatasetValidationError):
        normalize_huggingface_reference(reference)


def test_upload_adapter_and_session_api_flow(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("FORGE_STATE_PATH", str(tmp_path / "dataset-state.json"))
    for key in [
        "MODAL_TOKEN_ID",
        "MODAL_TOKEN_SECRET",
        "BASETEN_API_KEY",
        "SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "INTERNAL_API_KEY",
    ]:
        monkeypatch.setenv(key, "")
    get_settings.cache_clear()
    client = TestClient(app)

    uploaded = client.post(
        "/v1/datasets/upload",
        files={
            "file": (
                "custom.csv",
                b"ask,say\nWhat is Forge?,A post-training control plane.\n",
                "text/csv",
            )
        },
        data={"name": "Custom Q&A"},
    )
    assert uploaded.status_code == 200
    dataset = uploaded.json()["dataset"]
    assert dataset["status"] == "needs_mapping"

    adapted = client.post(
        f"/v1/datasets/{dataset['id']}/adapter",
        json={
            "adapter": {
                "format": "prompt_response",
                "promptField": "ask",
                "responseField": "say",
                "roleMap": {},
                "canonicalVersion": "forge-chat-v1",
            }
        },
    )
    assert adapted.status_code == 200
    assert adapted.json()["dataset"]["status"] == "ready"

    created = client.post(
        "/v1/sessions",
        json={
            "name": "custom data run",
            "model": "sshleifer/tiny-gpt2",
            "recipe": "chat-sft",
            "datasetId": dataset["id"],
            "targetSteps": 2,
        },
    )
    assert created.status_code == 200
    assert created.json()["session"]["datasetId"] == dataset["id"]
    assert created.json()["run"]["datasetId"] == dataset["id"]

    blocked_delete = client.delete(f"/v1/datasets/{dataset['id']}")
    assert blocked_delete.status_code == 409
