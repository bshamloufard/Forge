from __future__ import annotations

import os
import shutil
import subprocess
import textwrap
import uuid
import json
import time
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
    dataset_id: str = "Abirate/english_quotes",
    dataset_split: str = "train[:8]",
    max_steps: int = 2,
    max_length: int = 64,
) -> dict[str, Any]:
    import torch
    from datasets import load_dataset
    from transformers import AutoModelForCausalLM, AutoTokenizer

    started = time.time()
    output_dir = CHECKPOINT_ROOT / run_id
    output_dir.mkdir(parents=True, exist_ok=True)

    dataset = load_dataset(dataset_id, split=dataset_split)
    rows = [format_training_text(row) for row in dataset]
    rows = [row for row in rows if row.strip()]
    if not rows:
        raise ValueError(f"Dataset {dataset_id} {dataset_split} did not produce text rows")

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

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
        "dataset_id": dataset_id,
        "dataset_split": dataset_split,
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

    artifact_dir = CHECKPOINT_ROOT / run_id
    if not artifact_dir.exists():
        raise FileNotFoundError(f"Checkpoint artifact not found in Modal volume: {artifact_dir}")

    model_name = _baseten_safe_name(f"forge-{checkpoint_name}-{checkpoint_id}")
    deployment_name = _baseten_safe_name(f"{model_name}-{uuid.uuid4().hex[:8]}")
    truss_dir = Path("/tmp") / f"forge-truss-{checkpoint_id}"
    if truss_dir.exists():
        shutil.rmtree(truss_dir)
    (truss_dir / "model").mkdir(parents=True)
    shutil.copytree(artifact_dir, truss_dir / "model_artifacts")

    (truss_dir / "config.yaml").write_text(_truss_config(model_name))
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


def format_training_text(row: dict[str, Any]) -> str:
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


def _baseten_safe_name(value: str) -> str:
    normalized = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    parts = [part for part in normalized.split("-") if part]
    return "-".join(parts)[:63] or "forge-checkpoint"


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
                self._model = None
                self._tokenizer = None

            def load(self):
                artifact_dir = Path(__file__).resolve().parents[1] / "model_artifacts"
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
