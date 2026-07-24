from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import modal


APP_NAME = "forge-mvp"
CHECKPOINT_ROOT = Path("/checkpoints")

image = (
    modal.Image.debian_slim(python_version="3.11")
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
