"use client";

import {
  Activity,
  Archive,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Cloud,
  FlaskConical,
  GitBranch,
  Layers3,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  TerminalSquare,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { models, recipes } from "@/lib/recipes";
import type {
  Checkpoint,
  Deployment,
  ForgeState,
  ProviderHealth,
  RecipeId,
  Session,
  TrainingRun,
  VerifierScore
} from "@/lib/types";

type ApiState = ForgeState & { providers: ProviderHealth };

const nav = [
  ["Runs", Activity],
  ["Checkpoints", Archive],
  ["Verifier", BrainCircuit],
  ["Deployments", Cloud]
] as const;

export default function Home() {
  const [state, setState] = useState<ApiState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sample, setSample] = useState("");
  const [candidate, setCandidate] = useState(
    "The adapter should be promoted because it passes tests, preserves checkpoint lineage, and has verifier evidence for each rollout step."
  );
  const [rubric, setRubric] = useState(
    "Reward correct answer, evidence, checkpoint lineage, tests, and clear deployment readiness."
  );
  const [sessionForm, setSessionForm] = useState({
    name: "math verifier run",
    model: "qwen3-8b",
    recipe: "math-rl" as RecipeId,
    targetSteps: 96
  });

  async function refresh() {
    const response = await fetch("/api/state", { cache: "no-store" });
    setState(await response.json());
  }

  async function mutate<T>(label: string, path: string, body?: unknown): Promise<T> {
    setBusy(label);
    try {
      const response = await fetchWithRenderRetry(path, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!response.ok) throw new Error(response.errorText);
      const payload = (await response.json()) as T;
      await refresh();
      return payload;
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const activeRun = state?.runs[0];
  const activeSession = activeRun
    ? state?.sessions.find((session) => session.id === activeRun.sessionId)
    : state?.sessions[0];
  const latestCheckpoint = state?.checkpoints[0];

  const metrics = useMemo(() => {
    const runs = state?.runs ?? [];
    return [
      {
        label: "Active sessions",
        value: state?.sessions.length ?? 0,
        hint: "Project-scoped LoRA workspaces"
      },
      {
        label: "Training tokens",
        value: runs.reduce((sum, run) => sum + run.tokens, 0).toLocaleString(),
        hint: "Accumulated through forward_backward"
      },
      {
        label: "Best verifier",
        value: Math.max(0, ...runs.map((run) => run.verifierScore)).toFixed(2),
        hint: "Native verify/rank signal"
      },
      {
        label: "Estimated cost",
        value: `$${runs.reduce((sum, run) => sum + run.costUsd, 0).toFixed(2)}`,
        hint: "Mock cost ledger ready for providers"
      }
    ];
  }, [state]);

  if (!state) {
    return <main className="main">Loading control plane...</main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div>
            <div>Forge</div>
            <div className="muted">Tinkering MVP</div>
          </div>
        </div>
        <nav className="nav-stack" aria-label="Main">
          {nav.map(([label, Icon], index) => (
            <div className={`nav-item ${index === 0 ? "active" : ""}`} key={label}>
              <Icon size={17} />
              <span>{label}</span>
            </div>
          ))}
        </nav>
      </aside>

      <main className="main">
        <section className="topbar">
          <div>
            <div className="kicker">{state.project.organization} / {state.project.name}</div>
            <h1>Programmable post-training control plane</h1>
            <p className="subhead">
              Create LoRA sessions, drive training with explicit verbs, save checkpoints, run
              verifier scoring, and promote adapters to serving targets from one usable MVP.
            </p>
          </div>
          <div className="toolbar">
            <button
              className="button ghost"
              onClick={async () => {
                setBusy("reset");
                await fetch("/api/state", { method: "DELETE" });
                await refresh();
                setBusy(null);
              }}
              disabled={busy !== null}
              title="Reset demo state"
            >
              <RotateCcw size={17} />
            </button>
            <button
              className="button primary"
              onClick={() => mutate("new-session", "/api/sessions", sessionForm)}
              disabled={busy !== null}
            >
              <Play size={17} />
              New session
            </button>
          </div>
        </section>

        <section className="grid metrics">
          {metrics.map((metric) => (
            <div className="panel metric-card" key={metric.label}>
              <div className="metric-label">{metric.label}</div>
              <div className="metric-value">{metric.value}</div>
              <div className="metric-hint">{metric.hint}</div>
            </div>
          ))}
        </section>

        <section className="grid workspace">
          <div className="grid">
            <Panel icon={FlaskConical} title="Training sessions">
              <div className="two-col">
                <label>
                  Session name
                  <input
                    value={sessionForm.name}
                    onChange={(event) =>
                      setSessionForm({ ...sessionForm, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Model
                  <select
                    value={sessionForm.model}
                    onChange={(event) =>
                      setSessionForm({ ...sessionForm, model: event.target.value })
                    }
                  >
                    {models.map((model) => (
                      <option value={model} key={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Recipe
                  <select
                    value={sessionForm.recipe}
                    onChange={(event) =>
                      setSessionForm({
                        ...sessionForm,
                        recipe: event.target.value as RecipeId
                      })
                    }
                  >
                    {Object.entries(recipes).map(([id, recipe]) => (
                      <option value={id} key={id}>
                        {recipe.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Target steps
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={sessionForm.targetSteps}
                    onChange={(event) =>
                      setSessionForm({
                        ...sessionForm,
                        targetSteps: Number(event.target.value)
                      })
                    }
                  />
                </label>
              </div>
              <div style={{ height: 14 }} />
              <RunList
                runs={state.runs}
                sessions={state.sessions}
                busy={busy}
                onForward={(run) =>
                  mutate("forward", `/api/v1/training-runs/${run.id}/forward-backward`, {
                    microbatches: 4
                  })
                }
                onOptim={(run) =>
                  mutate("optim", `/api/v1/training-runs/${run.id}/optim-step`, {})
                }
                onCheckpoint={(run) =>
                  mutate("checkpoint", "/api/v1/checkpoints", { runId: run.id })
                }
              />
            </Panel>

            <Panel icon={TerminalSquare} title="Sampler">
              <div className="form-grid">
                <label>
                  Prompt
                  <textarea
                    value={recipes[activeSession?.recipe ?? "chat-sft"].defaultPrompt}
                    readOnly
                  />
                </label>
                <button
                  className="button"
                  disabled={!activeSession || busy !== null}
                  onClick={async () => {
                    if (!activeSession) return;
                    const result = await mutate<{ output: string }>("sample", "/api/sample", {
                      sessionId: activeSession.id,
                      prompt: recipes[activeSession.recipe].defaultPrompt
                    });
                    setSample(result.output);
                  }}
                >
                  <Sparkles size={17} />
                  Sample current adapter
                </button>
                <div className="terminal">{sample || "Sampler output will appear here."}</div>
              </div>
            </Panel>
          </div>

          <div className="grid">
            <Panel icon={BrainCircuit} title="Verifier primitive">
              <div className="form-grid">
                <label>
                  Rubric
                  <textarea value={rubric} onChange={(event) => setRubric(event.target.value)} />
                </label>
                <label>
                  Candidate
                  <textarea
                    value={candidate}
                    onChange={(event) => setCandidate(event.target.value)}
                  />
                </label>
                <button
                  className="button primary"
                  disabled={busy !== null}
                  onClick={() => mutate("verify", "/api/verify", { candidate, rubric })}
                >
                  <Zap size={17} />
                  Verify
                </button>
                <ScoreList scores={state.verifierScores} />
              </div>
            </Panel>

            <Panel icon={Archive} title="Checkpoints">
              <CheckpointList
                checkpoints={state.checkpoints}
                busy={busy}
                onDeploy={(checkpoint) =>
                  mutate("deploy", "/api/v1/deployments", {
                    checkpointId: checkpoint.id,
                    target: "baseten"
                  })
                }
              />
            </Panel>

            <Panel icon={Cloud} title="Deployments">
              <DeploymentList deployments={state.deployments} providers={state.providers} />
              {!latestCheckpoint ? null : (
                <p className="muted" style={{ marginTop: 12 }}>
                  Latest checkpoint can be promoted to Baseten now. Modal and Baseten keys are
                  detected automatically through environment variables.
                </p>
              )}
            </Panel>
          </div>
        </section>
      </main>
    </div>
  );
}

async function fetchWithRenderRetry(path: string, init: RequestInit) {
  let lastResponse: Response | null = null;
  let lastText = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(path, init);
    if (response.ok) {
      return Object.assign(response, { errorText: "" });
    }
    const text = await response.clone().text();
    lastResponse = response;
    lastText = text;
    if (!(response.status === 404 && text.trim() === "Not Found")) {
      return Object.assign(response, { errorText: text });
    }
    await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
  }

  return Object.assign(lastResponse as Response, { errorText: lastText });
}

function Panel({
  icon: Icon,
  title,
  children
}: {
  icon: typeof Activity;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <Icon size={18} />
          {title}
        </div>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function RunList({
  runs,
  sessions,
  busy,
  onForward,
  onOptim,
  onCheckpoint
}: {
  runs: TrainingRun[];
  sessions: Session[];
  busy: string | null;
  onForward: (run: TrainingRun) => void;
  onOptim: (run: TrainingRun) => void;
  onCheckpoint: (run: TrainingRun) => void;
}) {
  return (
    <div>
      {runs.map((run) => {
        const session = sessions.find((item) => item.id === run.sessionId);
        const percent = Math.round((run.step / run.targetSteps) * 100);
        return (
          <div className="run-row" key={run.id}>
            <div className="row-head">
              <div>
                <div className="row-title">{run.name}</div>
                <div className="muted">
                  {session?.model} / {session ? recipes[session.recipe].name : "recipe"}
                </div>
              </div>
              <span className={`pill ${run.status === "completed" ? "green" : "blue"}`}>
                <CheckCircle2 size={13} />
                {run.status}
              </span>
            </div>
            <div className="progress" aria-label={`${percent}% complete`}>
              <span style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
            <div className="row-head">
              <span className="muted">
                step {run.step}/{run.targetSteps} · loss {run.loss} · reward {run.reward} ·
                verifier {run.verifierScore}
              </span>
              <div className="toolbar">
                <button className="button" disabled={busy !== null} onClick={() => onForward(run)}>
                  <GitBranch size={16} />
                  forward_backward
                </button>
                <button className="button" disabled={busy !== null} onClick={() => onOptim(run)}>
                  <Layers3 size={16} />
                  optim_step
                </button>
                <button
                  className="button"
                  disabled={busy !== null}
                  onClick={() => onCheckpoint(run)}
                >
                  <Save size={16} />
                  save_state
                </button>
              </div>
            </div>
            <div className="terminal">{run.logs.slice(0, 4).join("\n")}</div>
          </div>
        );
      })}
    </div>
  );
}

function ScoreList({ scores }: { scores: VerifierScore[] }) {
  if (scores.length === 0) return <div className="empty">No verifier scores yet.</div>;
  return (
    <div className="score-list">
      {scores.slice(0, 4).map((score) => (
        <div className="score-row" key={score.id}>
          <span className="pill green">{score.score.toFixed(2)}</span>
          <div>
            <div>{score.candidate.slice(0, 110)}</div>
            <div className="muted">confidence {score.confidence.toFixed(2)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CheckpointList({
  checkpoints,
  busy,
  onDeploy
}: {
  checkpoints: Checkpoint[];
  busy: string | null;
  onDeploy: (checkpoint: Checkpoint) => void;
}) {
  if (checkpoints.length === 0) return <div className="empty">No checkpoints yet.</div>;
  return (
    <div>
      {checkpoints.slice(0, 5).map((checkpoint) => (
        <div className="checkpoint-row" key={checkpoint.id}>
          <div className="row-head">
            <div>
              <div className="row-title">{checkpoint.name}</div>
              <div className="muted">
                step {checkpoint.step} · {checkpoint.adapterType} · score {checkpoint.score}
              </div>
            </div>
            <button className="button" disabled={busy !== null} onClick={() => onDeploy(checkpoint)}>
              <Cloud size={16} />
              Deploy
            </button>
          </div>
          <div className="muted">{checkpoint.artifactUri}</div>
        </div>
      ))}
    </div>
  );
}

function DeploymentList({
  deployments,
  providers
}: {
  deployments: Deployment[];
  providers: ProviderHealth;
}) {
  return (
    <div>
      <div className="row-head">
        <span className={`pill ${providers.modal === "configured" ? "green" : "yellow"}`}>
          <Boxes size={13} />
          Modal {providers.modal}
        </span>
        <span className={`pill ${providers.baseten === "configured" ? "green" : "yellow"}`}>
          <Cloud size={13} />
          Baseten {providers.baseten}
        </span>
      </div>
      <div style={{ height: 12 }} />
      {deployments.length === 0 ? (
        <div className="empty">No deployments yet.</div>
      ) : (
        deployments.map((deployment) => (
          <div className="deployment-row" key={deployment.id}>
            <div className="row-head">
              <span className="row-title">{deployment.target}</span>
              <span className={`pill ${deployment.mode === "configured" ? "green" : "yellow"}`}>
                {deployment.status} / {deployment.mode}
              </span>
            </div>
            <div className="muted">{deployment.endpointUrl}</div>
          </div>
        ))
      )}
    </div>
  );
}
