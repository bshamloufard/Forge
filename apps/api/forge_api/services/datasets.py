from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from forge_api.models.domain import DatasetAdapter, DatasetQuality

MAX_UPLOAD_BYTES = 6 * 1024 * 1024
MAX_INSPECTION_ROWS = 100
MAX_PREVIEW_ROWS = 5
MAX_COLUMNS = 128
MAX_CANONICAL_PREVIEW_CHARACTERS = 2_000
DATASET_VIEWER_BASE = "https://datasets-server.huggingface.co"
_HF_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")


class DatasetValidationError(ValueError):
    pass


@dataclass
class DatasetInspection:
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int | None
    adapter: DatasetAdapter | None
    quality: DatasetQuality
    canonical_preview: list[str]
    source_config: str | None = None
    source_split: str = "train"
    warnings: list[str] = field(default_factory=list)
    validation_errors: list[str] = field(default_factory=list)

    @property
    def status(self) -> str:
        if self.adapter and self.quality.validRows:
            return "ready"
        return "needs_mapping"

    @property
    def preview(self) -> list[dict[str, Any]]:
        return [_safe_preview_row(row) for row in self.rows[:MAX_PREVIEW_ROWS]]


def inspect_uploaded_dataset(
    payload: bytes,
    filename: str,
    adapter: DatasetAdapter | None = None,
) -> DatasetInspection:
    if not payload:
        raise DatasetValidationError("The uploaded dataset is empty.")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise DatasetValidationError("Uploaded datasets are limited to 6 MiB. Link larger datasets from Hugging Face.")

    suffix = Path(filename).suffix.lower()
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise DatasetValidationError("Dataset files must use UTF-8 encoding.") from exc

    if suffix in {".jsonl", ".ndjson"}:
        rows = _parse_jsonl(text)
    elif suffix == ".json":
        rows = _parse_json(text)
    elif suffix == ".csv":
        rows = _parse_csv(text)
    else:
        raise DatasetValidationError("Use a .jsonl, .ndjson, .json, or .csv dataset file.")

    return inspect_rows(
        rows[:MAX_INSPECTION_ROWS],
        row_count=len(rows),
        adapter=adapter,
    )


def inspect_huggingface_dataset(
    reference: str,
    *,
    config: str | None = None,
    split: str | None = None,
    revision: str | None = None,
    adapter: DatasetAdapter | None = None,
) -> tuple[str, DatasetInspection]:
    dataset_id = normalize_huggingface_reference(reference)
    headers = {"user-agent": "Forge dataset registry/1.0"}

    try:
        with httpx.Client(timeout=20, headers=headers, follow_redirects=False) as client:
            split_response = client.get(
                f"{DATASET_VIEWER_BASE}/splits",
                params={"dataset": dataset_id},
            )
            _raise_viewer_error(split_response, dataset_id)
            available = split_response.json().get("splits", [])
            selected_config, selected_split = _select_config_split(available, config, split)

            preview_response = client.get(
                f"{DATASET_VIEWER_BASE}/first-rows",
                params={
                    "dataset": dataset_id,
                    "config": selected_config,
                    "split": selected_split,
                },
            )
            _raise_viewer_error(preview_response, dataset_id)
            preview_payload = preview_response.json()

            size_response = client.get(
                f"{DATASET_VIEWER_BASE}/size",
                params={"dataset": dataset_id},
            )
            row_count = None
            if size_response.is_success:
                row_count = _split_row_count(
                    size_response.json(),
                    selected_config,
                    selected_split,
                )
    except httpx.HTTPError as exc:
        raise DatasetValidationError("Hugging Face could not be reached to inspect this dataset.") from exc
    except (TypeError, ValueError) as exc:
        raise DatasetValidationError("Hugging Face returned an unexpected dataset response.") from exc

    rows = [
        item["row"]
        for item in preview_payload.get("rows", [])
        if isinstance(item, dict) and isinstance(item.get("row"), dict)
    ]
    if not rows:
        raise DatasetValidationError("The selected Hugging Face split did not return any preview rows.")

    inspection = inspect_rows(
        rows[:MAX_INSPECTION_ROWS],
        row_count=row_count,
        adapter=adapter,
        source_config=selected_config,
        source_split=selected_split,
    )
    inspection.warnings.append(
        f"Quality checks sampled {len(inspection.rows)} rows; the training worker streams the selected split."
    )
    if preview_payload.get("truncated"):
        inspection.warnings.append("Hugging Face truncated one or more preview values.")
    if revision:
        inspection.warnings.append(
            f"Training is pinned to revision {revision}; the Hub preview reflects the indexed viewer revision."
        )
    return dataset_id, inspection


def inspect_rows(
    rows: list[dict[str, Any]],
    *,
    row_count: int | None,
    adapter: DatasetAdapter | None = None,
    source_config: str | None = None,
    source_split: str = "train",
) -> DatasetInspection:
    if not rows:
        raise DatasetValidationError("The dataset did not contain any object rows.")
    if any(not isinstance(row, dict) for row in rows):
        raise DatasetValidationError("Every dataset record must be a JSON object or CSV row.")

    all_columns = sorted({str(key) for row in rows for key in row})
    columns = all_columns[:MAX_COLUMNS]
    selected_adapter = adapter or infer_adapter(rows, all_columns)
    canonical_rows: list[str] = []
    invalid_rows = 0
    for row in rows:
        canonical = canonicalize_row(row, selected_adapter) if selected_adapter else None
        if canonical:
            canonical_rows.append(canonical)
        else:
            invalid_rows += 1

    duplicate_rows = len(canonical_rows) - len(
        {hashlib.sha256(value.encode("utf-8")).hexdigest() for value in canonical_rows}
    )
    average_characters = (
        round(sum(len(value) for value in canonical_rows) / len(canonical_rows))
        if canonical_rows
        else 0
    )
    quality = DatasetQuality(
        inspectedRows=len(rows),
        validRows=len(canonical_rows),
        invalidRows=invalid_rows,
        duplicateRows=duplicate_rows,
        averageCharacters=average_characters,
    )
    warnings: list[str] = []
    validation_errors: list[str] = []
    if row_count is not None and row_count < 10:
        warnings.append("This dataset has fewer than 10 rows; it is useful for smoke tests, not model quality.")
    if invalid_rows:
        warnings.append(f"{invalid_rows} of {len(rows)} inspected rows do not match the selected adapter.")
    if duplicate_rows:
        warnings.append(f"{duplicate_rows} duplicate inspected rows were detected.")
    if len(all_columns) > MAX_COLUMNS:
        warnings.append(
            f"Only the first {MAX_COLUMNS} of {len(all_columns)} source columns are available for mapping."
        )
    if not selected_adapter:
        validation_errors.append("Choose how the source columns map to training text or messages.")
    elif not canonical_rows:
        validation_errors.append("The selected adapter did not produce any usable training records.")

    return DatasetInspection(
        columns=columns,
        rows=rows,
        row_count=row_count,
        adapter=selected_adapter,
        quality=quality,
        canonical_preview=[
            (
                value
                if len(value) <= MAX_CANONICAL_PREVIEW_CHARACTERS
                else f"{value[: MAX_CANONICAL_PREVIEW_CHARACTERS - 1]}…"
            )
            for value in canonical_rows[:MAX_PREVIEW_ROWS]
        ],
        source_config=source_config,
        source_split=source_split,
        warnings=warnings,
        validation_errors=validation_errors,
    )


def infer_adapter(rows: list[dict[str, Any]], columns: list[str]) -> DatasetAdapter | None:
    sample = next((row for row in rows if row), {})
    messages = sample.get("messages")
    if _looks_like_messages(messages, "role", "content"):
        return DatasetAdapter(
            format="messages",
            messagesField="messages",
            roleField="role",
            contentField="content",
        )

    conversations = sample.get("conversations")
    if _looks_like_messages(conversations, "from", "value"):
        return DatasetAdapter(
            format="messages",
            messagesField="conversations",
            roleField="from",
            contentField="value",
            roleMap={"human": "user", "gpt": "assistant", "bot": "assistant"},
        )

    for prompt_field, response_field in [
        ("instruction", "output"),
        ("prompt", "response"),
        ("question", "answer"),
        ("input", "output"),
    ]:
        if _string_value(sample.get(prompt_field)) and _string_value(sample.get(response_field)):
            input_field = "input" if prompt_field == "instruction" and "input" in columns else None
            return DatasetAdapter(
                format="prompt_response",
                promptField=prompt_field,
                responseField=response_field,
                inputField=input_field,
            )

    for text_field in ["text", "content", "quote"]:
        if _string_value(sample.get(text_field)):
            return DatasetAdapter(format="text", textField=text_field)

    string_columns = [
        column
        for column in columns
        if any(_string_value(row.get(column)) for row in rows[:10])
    ]
    if len(string_columns) == 1:
        return DatasetAdapter(format="text", textField=string_columns[0])
    return None


def canonicalize_row(row: dict[str, Any], adapter: DatasetAdapter | None) -> str | None:
    if not adapter:
        return None
    if adapter.format == "text":
        return _string_value(row.get(adapter.textField or ""))
    if adapter.format == "prompt_response":
        prompt = _string_value(row.get(adapter.promptField or ""))
        response = _string_value(row.get(adapter.responseField or ""))
        if not prompt or not response:
            return None
        optional_input = _string_value(row.get(adapter.inputField or "")) if adapter.inputField else None
        messages = []
        user_content = prompt if not optional_input else f"{prompt}\n\nInput:\n{optional_input}"
        messages.append({"role": "user", "content": user_content})
        messages.append({"role": "assistant", "content": response})
        return json.dumps({"messages": messages}, ensure_ascii=False)
    if adapter.format == "messages":
        value = row.get(adapter.messagesField or "")
        if not isinstance(value, list):
            return None
        role_field = adapter.roleField or "role"
        content_field = adapter.contentField or "content"
        role_map = {
            "system": "system",
            "user": "user",
            "assistant": "assistant",
            "tool": "tool",
            "human": "user",
            "gpt": "assistant",
            "bot": "assistant",
            **{key.lower(): mapped for key, mapped in adapter.roleMap.items()},
        }
        messages = []
        for item in value:
            if not isinstance(item, dict):
                continue
            source_role = _string_value(item.get(role_field))
            content = _string_value(item.get(content_field))
            if not source_role or not content:
                continue
            role = role_map.get(source_role.lower(), source_role.lower())
            if role not in {"system", "user", "assistant", "tool"}:
                continue
            messages.append({"role": role, "content": content})
        if not messages or not any(message["role"] == "assistant" for message in messages):
            return None
        return json.dumps({"messages": messages}, ensure_ascii=False)
    return None


def normalize_huggingface_reference(reference: str) -> str:
    value = reference.strip().rstrip("/")
    if "://" in value:
        parsed = urlparse(value)
        if (
            parsed.scheme != "https"
            or parsed.hostname != "huggingface.co"
            or parsed.username
            or parsed.password
            or parsed.port
        ):
            raise DatasetValidationError("Use a huggingface.co dataset URL or an owner/dataset identifier.")
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) != 3 or parts[0] != "datasets":
            raise DatasetValidationError("Hugging Face links must look like huggingface.co/datasets/owner/dataset.")
        value = "/".join(parts[1:])

    parts = value.split("/")
    if len(parts) != 2 or not all(_HF_SEGMENT.fullmatch(part) for part in parts):
        raise DatasetValidationError("Hugging Face dataset identifiers must use owner/dataset format.")
    return value


def _parse_jsonl(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise DatasetValidationError(f"Invalid JSON on line {line_number}.") from exc
        if not isinstance(value, dict):
            raise DatasetValidationError(f"JSONL line {line_number} must contain an object.")
        rows.append(value)
    return rows


def _parse_json(text: str) -> list[dict[str, Any]]:
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise DatasetValidationError("The uploaded JSON file is invalid.") from exc
    if isinstance(value, dict):
        for key in ("data", "rows", "train"):
            if isinstance(value.get(key), list):
                value = value[key]
                break
    if not isinstance(value, list) or not all(isinstance(row, dict) for row in value):
        raise DatasetValidationError("JSON datasets must be an array of objects.")
    return value


def _parse_csv(text: str) -> list[dict[str, Any]]:
    try:
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            raise DatasetValidationError("The CSV file needs a header row.")
        return [dict(row) for row in reader]
    except csv.Error as exc:
        raise DatasetValidationError("The uploaded CSV file is invalid.") from exc


def _select_config_split(
    available: Any,
    requested_config: str | None,
    requested_split: str | None,
) -> tuple[str, str]:
    candidates = [
        item
        for item in available
        if isinstance(item, dict)
        and isinstance(item.get("config"), str)
        and isinstance(item.get("split"), str)
    ]
    if requested_config:
        candidates = [item for item in candidates if item["config"] == requested_config]
    if requested_split:
        candidates = [item for item in candidates if item["split"] == requested_split]
    if not candidates:
        raise DatasetValidationError("The requested Hugging Face configuration or split was not found.")
    selected = next((item for item in candidates if item["split"] == "train"), candidates[0])
    return selected["config"], selected["split"]


def _split_row_count(payload: Any, config: str, split: str) -> int | None:
    entries = payload.get("size", {}).get("splits", []) if isinstance(payload, dict) else []
    match = next(
        (
            item
            for item in entries
            if isinstance(item, dict)
            and item.get("config") == config
            and item.get("split") == split
        ),
        None,
    )
    value = match.get("num_rows") if match else None
    return value if isinstance(value, int) else None


def _raise_viewer_error(response: httpx.Response, dataset_id: str) -> None:
    if response.is_success:
        return
    if response.status_code in {401, 403}:
        raise DatasetValidationError(
            "This Hugging Face dataset is private or gated. Public datasets are supported in this release."
        )
    if response.status_code == 404:
        raise DatasetValidationError(f"Hugging Face dataset {dataset_id} was not found or is not viewer-ready.")
    raise DatasetValidationError(
        f"Hugging Face dataset inspection failed with status {response.status_code}."
    )


def _looks_like_messages(value: Any, role_field: str, content_field: str) -> bool:
    return (
        isinstance(value, list)
        and bool(value)
        and isinstance(value[0], dict)
        and role_field in value[0]
        and content_field in value[0]
    )


def _string_value(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _safe_preview_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        str(key): _safe_preview_value(value, depth=0)
        for key, value in list(row.items())[:MAX_COLUMNS]
    }


def _safe_preview_value(value: Any, *, depth: int) -> Any:
    if depth >= 3:
        return "…"
    if isinstance(value, str):
        return value if len(value) <= 500 else f"{value[:497]}…"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        items = [_safe_preview_value(item, depth=depth + 1) for item in value[:8]]
        if len(value) > 8:
            items.append("…")
        return items
    if isinstance(value, dict):
        return {
            str(key): _safe_preview_value(item, depth=depth + 1)
            for key, item in list(value.items())[:12]
        }
    return str(value)[:500]
