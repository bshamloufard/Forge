from __future__ import annotations

from typing import Any

from forge_api.settings import Settings


def run_tiny_finetune(settings: Settings, *, run_id: str) -> dict[str, Any]:
    import modal

    function = modal.Function.from_name(
        settings.modal_app_name,
        "run_tiny_finetune",
        environment_name=settings.modal_environment,
    )
    return function.remote(
        run_id=run_id,
        model_id=settings.training_model_id,
        dataset_id=settings.training_dataset_id,
        dataset_split=settings.training_dataset_split,
        max_steps=settings.training_max_steps,
    )
