import json
from datetime import UTC, datetime
from pathlib import Path

from forge_api.ids import create_id
from forge_api.models.domain import Checkpoint, Deployment, ForgeState, Project, Session, TrainingRun, VerifierScore
from forge_api.providers.health import create_serving_endpoint
from forge_api.recipes import recipes
from forge_api.services.verifier import score_candidate
from forge_api.settings import Settings


def now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class StateRepository:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.path = _resolve_path(settings.state_path)

    def read(self) -> ForgeState:
        try:
            return ForgeState.model_validate(json.loads(self.path.read_text()))
        except Exception:
            state = self.initial_state()
            self.write(state)
            return state

    def write(self, state: ForgeState) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(state.model_dump_json(indent=2))

    def reset(self) -> ForgeState:
        state = self.initial_state()
        self.write(state)
        return state

    def initial_state(self) -> ForgeState:
        created_at = now()
        session_id = create_id("ses")
        run_id = create_id("run")
        checkpoint_id = create_id("ckpt")
        return ForgeState(
            project=Project(id="proj_default", name="Forge Research", organization="Default Org", createdAt=created_at),
            sessions=[
                Session(
                    id=session_id,
                    projectId="proj_default",
                    name="qwen3 chat-sft baseline",
                    creator="researcher@forge.local",
                    model="qwen3-8b",
                    recipe="chat-sft",
                    createdAt=created_at,
                    updatedAt=created_at,
                )
            ],
            runs=[
                TrainingRun(
                    id=run_id,
                    sessionId=session_id,
                    name="baseline-lora",
                    status="running",
                    step=42,
                    targetSteps=120,
                    loss=1.62,
                    reward=0.48,
                    verifierScore=0.57,
                    tokens=184000,
                    costUsd=7.84,
                    logs=[
                        "session opened on modal adapter",
                        "sampled 16 prompts from chat-sft seed set",
                        "forward_backward accumulated 4 microbatches",
                        "optim_step applied LoRA rank=16 update",
                    ],
                    createdAt=created_at,
                    updatedAt=created_at,
                )
            ],
            checkpoints=[
                Checkpoint(
                    id=checkpoint_id,
                    sessionId=session_id,
                    runId=run_id,
                    name="baseline-step-040",
                    step=40,
                    artifactUri="supabase://mock-artifacts/checkpoints/baseline-step-040.safetensors",
                    score=0.55,
                    createdAt=created_at,
                )
            ],
            deployments=[],
            verifierScores=[
                VerifierScore(
                    id=create_id("ver"),
                    candidate=(
                        "The model uses explicit checkpoints so each experiment can be resumed, exported, "
                        "evaluated, and deployed without losing lineage."
                    ),
                    rubric="Clear explanation with checkpoint, resume, export, evaluation, and deployment coverage.",
                    score=0.82,
                    confidence=0.76,
                    rationale="Seed verifier example for the dashboard.",
                    createdAt=created_at,
                )
            ],
        )

    def create_session(self, *, name: str, model: str, recipe: str, target_steps: int | None) -> dict[str, object]:
        state = self.read()
        timestamp = now()
        session = Session(
            id=create_id("ses"),
            projectId=state.project.id,
            name=name,
            creator="researcher@forge.local",
            model=model,
            recipe=recipe,  # type: ignore[arg-type]
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        run = TrainingRun(
            id=create_id("run"),
            sessionId=session.id,
            name=f"{recipes[session.recipe]['name'].lower().replace(' ', '-')}-run",
            status="queued",
            step=0,
            targetSteps=target_steps or 100,
            loss=2.4,
            reward=0.22,
            verifierScore=0.31,
            tokens=0,
            costUsd=0,
            logs=[f"created {recipes[session.recipe]['name']} session for {model}", "waiting for first forward_backward call"],
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        state.sessions.insert(0, session)
        state.runs.insert(0, run)
        self.write(state)
        return {"state": state, "session": session, "run": run}

    def forward_backward(self, run_id: str, microbatches: int = 4) -> dict[str, object]:
        state = self.read()
        run = _find_run(state, run_id)
        run.status = "running"
        run.step = min(run.targetSteps, run.step + max(1, microbatches))
        run.tokens += microbatches * 2048
        run.loss = round(max(0.32, run.loss * (0.985 - min(0.004, microbatches / 400))), 3)
        run.reward = round(min(0.96, run.reward + 0.012 * microbatches), 3)
        run.verifierScore = round(min(0.98, run.verifierScore + 0.01 * microbatches), 3)
        run.costUsd = round(run.costUsd + microbatches * 0.18, 2)
        run.updatedAt = now()
        run.logs.insert(0, f"forward_backward accumulated {microbatches} microbatches at step {run.step}")
        if run.step >= run.targetSteps:
            run.status = "completed"
        self.write(state)
        return {"state": state, "run": run}

    def optim_step(self, run_id: str) -> dict[str, object]:
        state = self.read()
        run = _find_run(state, run_id)
        run.status = "completed" if run.step >= run.targetSteps else "running"
        run.loss = round(max(0.28, run.loss - 0.035), 3)
        run.reward = round(min(0.99, run.reward + 0.025), 3)
        run.verifierScore = round(min(0.99, run.verifierScore + 0.018), 3)
        run.costUsd = round(run.costUsd + 0.42, 2)
        run.updatedAt = now()
        run.logs.insert(0, "optim_step applied LoRA adapter update and refreshed sampler weights")
        self.write(state)
        return {"state": state, "run": run}

    def save_checkpoint(self, run_id: str, name: str | None = None) -> dict[str, object]:
        state = self.read()
        run = _find_run(state, run_id)
        checkpoint = Checkpoint(
            id=create_id("ckpt"),
            sessionId=run.sessionId,
            runId=run.id,
            name=name or f"{run.name}-step-{run.step:03d}",
            step=run.step,
            artifactUri=f"supabase://mock-artifacts/checkpoints/{run.id}/step-{run.step}.safetensors",
            score=run.verifierScore,
            createdAt=now(),
        )
        state.checkpoints.insert(0, checkpoint)
        run.logs.insert(0, f"save_state wrote {checkpoint.name}")
        run.updatedAt = now()
        self.write(state)
        return {"state": state, "checkpoint": checkpoint}

    def sample_from_session(self, session_id: str, prompt: str) -> dict[str, object]:
        state = self.read()
        session = next((item for item in state.sessions if item.id == session_id), None)
        if session is None:
            raise KeyError("Session not found")
        recipe = recipes[session.recipe]
        output = "\n".join(
            [
                f"Model {session.model} sampled under {recipe['name']}.",
                f"Prompt: {prompt}",
                (
                    f"Answer: {recipe['objective']} The current adapter would respond with a concise plan, "
                    "cite artifacts, and ask the verifier for a confidence score before promotion."
                ),
            ]
        )
        return {"output": output, "session": session}

    def verify_candidate(
        self,
        candidate: str,
        rubric: str | None = None,
        reference: str | None = None,
        criteria: list[dict[str, float | str]] | None = None,
    ) -> dict[str, object]:
        state = self.read()
        result = score_candidate(candidate, rubric or "", reference or "", criteria)
        verifier_score = VerifierScore(
            id=create_id("ver"),
            candidate=candidate,
            rubric=rubric or "General task correctness and evidence quality.",
            score=float(result["score"]),
            confidence=float(result["confidence"]),
            rationale=str(result["rationale"]),
            createdAt=now(),
        )
        state.verifierScores.insert(0, verifier_score)
        self.write(state)
        return {"state": state, "verifierScore": verifier_score, **result}

    def deploy_checkpoint(self, checkpoint_id: str, target: str) -> dict[str, object]:
        state = self.read()
        checkpoint = next((item for item in state.checkpoints if item.id == checkpoint_id), None)
        if checkpoint is None:
            raise KeyError("Checkpoint not found")
        endpoint = create_serving_endpoint(checkpoint.name, target, self.settings)
        deployment = Deployment(
            id=create_id("dep"),
            checkpointId=checkpoint_id,
            target=target,  # type: ignore[arg-type]
            status="live",
            endpointUrl=endpoint["endpointUrl"],
            mode=endpoint["mode"],  # type: ignore[arg-type]
            createdAt=now(),
        )
        state.deployments.insert(0, deployment)
        self.write(state)
        return {"state": state, "deployment": deployment}


def _resolve_path(path: Path) -> Path:
    return path if path.is_absolute() else Path.cwd() / path


def _find_run(state: ForgeState, run_id: str) -> TrainingRun:
    run = next((item for item in state.runs if item.id == run_id), None)
    if run is None:
        raise KeyError("Run not found")
    return run

