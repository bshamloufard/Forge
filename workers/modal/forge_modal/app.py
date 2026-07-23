try:
    import modal
except Exception:  # pragma: no cover - local tests do not need Modal installed.
    modal = None


if modal is not None:
    app = modal.App("forge-mvp")

    @app.function()
    def run_training_step(run_id: str, microbatches: int = 4) -> dict[str, object]:
        return {"run_id": run_id, "microbatches": microbatches, "status": "completed"}
else:
    app = None


def run_training_step(run_id: str, microbatches: int = 4) -> dict[str, object]:
    return {"run_id": run_id, "microbatches": microbatches, "status": "mock"}

