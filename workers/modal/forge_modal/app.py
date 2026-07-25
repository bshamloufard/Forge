from __future__ import annotations

import os
import shutil
import subprocess
import textwrap
import uuid
import json
import time
from itertools import islice
from pathlib import Path
from typing import Any

import modal


APP_NAME = "forge-mvp"
CHECKPOINT_ROOT = Path("/checkpoints")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ca-certificates", "curl")
    .run_commands(
        "curl -sL https://github.com/basetenlabs/baseten-cli/releases/download/v0.3.0/baseten_0.3.0_linux_amd64.tar.gz "
        "| tar xz -C /usr/local/bin baseten"
    )
    .pip_install(
        "datasets>=3.0",
        "torch>=2.5",
        "transformers>=4.48",
    )
)

checkpoints = modal.Volume.from_name("forge-checkpoints", create_if_missing=True)
app = modal.App(APP_NAME)


@app.function(
    image=image,
    volumes={str(CHECKPOINT_ROOT): checkpoints},
    timeout=20 * 60,
    cpu=2,
    memory=4096,
)
def run_tiny_finetune(
    run_id: str,
    model_id: str = "sshleifer/tiny-gpt2",
    dataset_source_type: str = "huggingface",
    dataset_id: str = "Abirate/english_quotes",
    dataset_config: str | None = None,
    dataset_split: str = "train[:8]",
    dataset_revision: str | None = None,
    dataset_url: str | None = None,
    dataset_filename: str | None = None,
    dataset_adapter: dict[str, Any] | None = None,
    max_steps: int = 2,
    max_rows: int = 256,
    max_length: int = 64,
) -> dict[str, Any]:
    import torch
    from datasets import load_dataset
    from transformers import AutoModelForCausalLM, AutoTokenizer

    started = time.time()
    checkpoints.reload()
    output_dir = CHECKPOINT_ROOT / run_id
    output_dir.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    if dataset_source_type == "upload":
        if not dataset_url:
            raise ValueError("Uploaded dataset URL is required")
        suffix = Path(dataset_filename or "").suffix.lower()
        loader = "csv" if suffix == ".csv" else "json"
        dataset = load_dataset(
            loader,
            data_files={"train": dataset_url},
            split="train",
            streaming=True,
        )
    else:
        load_kwargs: dict[str, Any] = {
            "split": dataset_split,
            "streaming": "[" not in dataset_split,
        }
        if dataset_revision:
            load_kwargs["revision"] = dataset_revision
        dataset = load_dataset(dataset_id, dataset_config, **load_kwargs)

    rows = [
        text
        for row in islice(iter(dataset), max(1, max_rows))
        if (text := format_training_text(row, dataset_adapter, tokenizer)).strip()
    ]
    if not rows:
        raise ValueError(f"Dataset {dataset_id} {dataset_split} did not produce text rows")

    model = AutoModelForCausalLM.from_pretrained(model_id)
    model.train()

    optimizer = torch.optim.AdamW(model.parameters(), lr=5e-5)
    losses: list[float] = []
    tokens_seen = 0

    for step in range(max(1, max_steps)):
        text = rows[step % len(rows)]
        batch = tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            padding="max_length",
            max_length=max_length,
        )
        labels = batch["input_ids"].clone()
        labels[batch["attention_mask"] == 0] = -100

        optimizer.zero_grad(set_to_none=True)
        result = model(**batch, labels=labels)
        result.loss.backward()
        optimizer.step()

        losses.append(float(result.loss.detach().cpu()))
        tokens_seen += int(batch["attention_mask"].sum().item())

    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    metadata = {
        "run_id": run_id,
        "model_id": model_id,
        "dataset_source_type": dataset_source_type,
        "dataset_id": dataset_id,
        "dataset_config": dataset_config,
        "dataset_split": dataset_split,
        "dataset_revision": dataset_revision,
        "dataset_adapter": dataset_adapter,
        "rows": len(rows),
        "steps": len(losses),
        "loss": losses[-1],
        "tokens": tokens_seen,
        "duration_seconds": round(time.time() - started, 3),
        "artifact_uri": f"modal-volume://forge-checkpoints/{run_id}",
    }
    (output_dir / "forge_metadata.json").write_text(json.dumps(metadata, indent=2))
    checkpoints.commit()
    return metadata


@app.function(
    image=image,
    volumes={str(CHECKPOINT_ROOT): checkpoints},
    timeout=45 * 60,
    cpu=2,
    memory=4096,
)
def deploy_checkpoint_to_baseten(
    run_id: str,
    checkpoint_id: str,
    checkpoint_name: str,
    baseten_api_key: str,
    wait_for_live: bool = False,
) -> dict[str, Any]:
    if not baseten_api_key.strip():
        raise ValueError("BASETEN_API_KEY is required")

    checkpoints.reload()
    artifact_dir = CHECKPOINT_ROOT / run_id
    if not artifact_dir.exists():
        raise FileNotFoundError(f"Checkpoint artifact not found in Modal volume: {artifact_dir}")

    deployment_suffix = uuid.uuid4().hex[:8]
    model_name = _baseten_name_with_suffix(f"forge-{checkpoint_name}-{checkpoint_id}", deployment_suffix)
    deployment_name = _baseten_name_with_suffix(f"{model_name}-deployment", deployment_suffix)
    truss_dir = Path("/tmp") / f"forge-truss-{checkpoint_id}"
    if truss_dir.exists():
        shutil.rmtree(truss_dir)
    (truss_dir / "model").mkdir(parents=True)
    shutil.copytree(artifact_dir, truss_dir / "data" / "model_artifacts")

    (truss_dir / "config.yaml").write_text(_truss_config(model_name))
    (truss_dir / "model" / "__init__.py").write_text("")
    (truss_dir / "model" / "model.py").write_text(_truss_model_py(model_name))

    env = os.environ.copy()
    env["BASETEN_API_KEY"] = baseten_api_key
    command = [
        "baseten",
        "model",
        "push",
        "--dir",
        str(truss_dir),
        "--output",
        "json",
        "--deployment-name",
        deployment_name,
        "--labels",
        json.dumps({"source": "forge", "checkpoint_id": checkpoint_id, "run_id": run_id}),
    ]
    if wait_for_live:
        command.extend(["--wait", "--deploy-timeout", "30m"])

    result = subprocess.run(
        command,
        capture_output=True,
        env=env,
        text=True,
        timeout=40 * 60,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "baseten model push failed: "
            f"stdout={result.stdout[-2000:]} stderr={result.stderr[-4000:]}"
        )

    payload = json.loads(result.stdout or "{}")
    return {
        "artifact_uri": f"modal-volume://forge-checkpoints/{run_id}",
        "model_id": payload.get("model", {}).get("id"),
        "deployment_id": payload.get("deployment", {}).get("id"),
        "deployment_status": payload.get("deployment", {}).get("status"),
        "deployment_name": payload.get("deployment", {}).get("name") or deployment_name,
        "model_name": payload.get("model", {}).get("name") or model_name,
        "predict_url": payload.get("predict_url"),
        "logs_url": payload.get("logs_url"),
    }


@app.function(
    image=image,
    timeout=10 * 60,
    cpu=1,
    memory=1024,
)
def deactivate_baseten_deployment(
    model_id: str,
    deployment_id: str,
    baseten_api_key: str,
) -> dict[str, Any]:
    if not baseten_api_key.strip():
        raise ValueError("BASETEN_API_KEY is required")

    env = os.environ.copy()
    env["BASETEN_API_KEY"] = baseten_api_key
    result = subprocess.run(
        [
            "baseten",
            "model",
            "deployment",
            "deactivate",
            "--model-id",
            model_id,
            "--deployment-id",
            deployment_id,
            "--yes",
            "--output",
            "json",
        ],
        capture_output=True,
        env=env,
        text=True,
        timeout=8 * 60,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "baseten deployment deactivate failed: "
            f"stdout={result.stdout[-2000:]} stderr={result.stderr[-4000:]}"
        )
    return {
        "model_id": model_id,
        "deployment_id": deployment_id,
        "stdout": result.stdout,
    }


@app.function(
    image=image,
    timeout=10 * 60,
    cpu=1,
    memory=1024,
)
def delete_baseten_model(
    model_id: str,
    baseten_api_key: str,
) -> dict[str, Any]:
    if not baseten_api_key.strip():
        raise ValueError("BASETEN_API_KEY is required")

    env = os.environ.copy()
    env["BASETEN_API_KEY"] = baseten_api_key
    result = subprocess.run(
        [
            "baseten",
            "model",
            "delete",
            "--model-id",
            model_id,
            "--yes",
            "--output",
            "json",
        ],
        capture_output=True,
        env=env,
        text=True,
        timeout=8 * 60,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "baseten model delete failed: "
            f"stdout={result.stdout[-2000:]} stderr={result.stderr[-4000:]}"
        )
    return {
        "model_id": model_id,
        "stdout": result.stdout,
    }


@app.function(
    image=image,
    volumes={str(CHECKPOINT_ROOT): checkpoints},
    timeout=10 * 60,
    cpu=1,
    memory=1024,
)
def delete_checkpoint_artifact(run_id: str) -> dict[str, Any]:
    try:
        checkpoints.remove_file(run_id, recursive=True)
    except (FileNotFoundError, modal.exception.InvalidError, modal.exception.NotFoundError):
        return {"run_id": run_id, "deleted": False}
    return {"run_id": run_id, "deleted": True}


def format_training_text(
    row: dict[str, Any],
    adapter: dict[str, Any] | None = None,
    tokenizer: Any | None = None,
) -> str:
    if adapter:
        adapter_format = adapter.get("format")
        if adapter_format == "text":
            return _nonempty_text(row.get(adapter.get("textField") or "")) or ""
        if adapter_format == "prompt_response":
            prompt = _nonempty_text(row.get(adapter.get("promptField") or ""))
            response = _nonempty_text(row.get(adapter.get("responseField") or ""))
            optional_input = _nonempty_text(row.get(adapter.get("inputField") or ""))
            if not prompt or not response:
                return ""
            user_content = prompt if not optional_input else f"{prompt}\n\nInput:\n{optional_input}"
            return _format_messages(
                [
                    {"role": "user", "content": user_content},
                    {"role": "assistant", "content": response},
                ],
                tokenizer,
            )
        if adapter_format == "messages":
            messages = _adapt_messages(row, adapter)
            return _format_messages(messages, tokenizer) if messages else ""

    if "quote" in row:
        author = row.get("author") or "unknown"
        return f"Quote by {author}: {row['quote']}"
    if "instruction" in row and "output" in row:
        return f"Instruction: {row['instruction']}\nAnswer: {row['output']}"
    if "prompt" in row and "response" in row:
        return f"Prompt: {row['prompt']}\nResponse: {row['response']}"
    if "text" in row:
        return str(row["text"])
    return " ".join(str(value) for value in row.values() if isinstance(value, str))


def _adapt_messages(row: dict[str, Any], adapter: dict[str, Any]) -> list[dict[str, str]]:
    value = row.get(adapter.get("messagesField") or "")
    if not isinstance(value, list):
        return []
    role_field = adapter.get("roleField") or "role"
    content_field = adapter.get("contentField") or "content"
    role_map = {
        "system": "system",
        "user": "user",
        "assistant": "assistant",
        "tool": "tool",
        "human": "user",
        "gpt": "assistant",
        "bot": "assistant",
        **{
            str(key).lower(): str(mapped).lower()
            for key, mapped in (adapter.get("roleMap") or {}).items()
        },
    }
    messages = []
    for item in value:
        if not isinstance(item, dict):
            continue
        source_role = _nonempty_text(item.get(role_field))
        content = _nonempty_text(item.get(content_field))
        if not source_role or not content:
            continue
        role = role_map.get(source_role.lower(), source_role.lower())
        if role in {"system", "user", "assistant", "tool"}:
            messages.append({"role": role, "content": content})
    if not any(message["role"] == "assistant" for message in messages):
        return []
    return messages


def _format_messages(messages: list[dict[str, str]], tokenizer: Any | None) -> str:
    if tokenizer is not None and getattr(tokenizer, "chat_template", None):
        return str(
            tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=False,
            )
        )
    return "\n".join(f"{message['role'].title()}: {message['content']}" for message in messages)


def _nonempty_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _baseten_safe_name(value: str) -> str:
    normalized = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    parts = [part for part in normalized.split("-") if part]
    return "-".join(parts)[:63].strip("-") or "forge-checkpoint"


def _baseten_name_with_suffix(value: str, suffix: str, max_length: int = 63) -> str:
    suffix = _baseten_safe_name(suffix)
    base_length = max(1, max_length - len(suffix) - 1)
    base = _baseten_safe_name(value)[:base_length].strip("-") or "forge"
    return f"{base}-{suffix}"


def _truss_config(model_name: str) -> str:
    return textwrap.dedent(
        f"""
        model_name: {model_name}
        python_version: py311
        model_metadata:
          example_model_input:
            prompt: "Reply with exactly: forge manual ok"
            max_tokens: 24
        requirements:
          - torch>=2.5,<3
          - transformers>=4.48,<5
        resources:
          accelerator: null
          cpu: "4"
          memory: 16Gi
          use_gpu: false
        secrets: {{}}
        system_packages: []
        environment_variables: {{}}
        external_package_dirs: []
        """
    ).lstrip()


def _truss_model_py(model_name: str) -> str:
    return textwrap.dedent(
        f'''
        from __future__ import annotations

        import time
        import uuid
        from pathlib import Path

        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer


        MODEL_NAME = "{model_name}"


        class Model:
            def __init__(self, **kwargs):
                self._data_dir = kwargs["data_dir"]
                self._model = None
                self._tokenizer = None

            def load(self):
                artifact_dir = Path(self._data_dir) / "model_artifacts"
                self._tokenizer = AutoTokenizer.from_pretrained(artifact_dir)
                if self._tokenizer.pad_token is None:
                    self._tokenizer.pad_token = self._tokenizer.eos_token
                self._model = AutoModelForCausalLM.from_pretrained(artifact_dir)
                self._model.eval()

            def predict(self, model_input):
                prompt = _prompt_from_input(model_input)
                max_tokens = int(model_input.get("max_tokens", model_input.get("max_new_tokens", 64)))
                encoded = self._tokenizer(prompt, return_tensors="pt", truncation=True, max_length=256)
                with torch.no_grad():
                    output = self._model.generate(
                        **encoded,
                        do_sample=False,
                        max_new_tokens=max(1, min(max_tokens, 128)),
                        pad_token_id=self._tokenizer.eos_token_id,
                    )
                generated = output[0][encoded["input_ids"].shape[-1]:]
                content = self._tokenizer.decode(generated, skip_special_tokens=True).strip()
                return {{
                    "id": f"chatcmpl-{{uuid.uuid4().hex}}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": MODEL_NAME,
                    "choices": [
                        {{
                            "index": 0,
                            "message": {{"role": "assistant", "content": content}},
                            "finish_reason": "stop",
                        }}
                    ],
                }}


        def _prompt_from_input(model_input):
            if not isinstance(model_input, dict):
                return str(model_input)
            if model_input.get("messages"):
                return "\\n".join(
                    f"{{message.get('role', 'user')}}: {{message.get('content', '')}}"
                    for message in model_input["messages"]
                    if isinstance(message, dict)
                )
            return str(model_input.get("prompt") or "Hello")
        '''
    ).lstrip()
