"use client";

import {
  Activity,
  Archive,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers3,
  LineChart,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
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
type IconComponent = typeof Activity;

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
const apiPath = (path: string) => `${apiBase}${path}`;

const nav = [
  ["Overview", "top", Gauge],
  ["Runs", "runs", Activity],
  ["Verifier", "verifier", BrainCircuit],
  ["Lineage", "checkpoints", Archive],
  ["Serving", "deployments", Cloud]
] as const;

const pipeline = [
  ["Session", FlaskConical],
  ["Rollout", Activity],
  ["Reward", BrainCircuit],
  ["State", Archive],
  ["Serve", Cloud]
] as const;

const activityBars = [42, 48, 37, 63, 58, 72, 67, 81, 76, 88, 79, 92, 84, 74, 86, 69];

export default function Home() {
  const [state, setState] = useState<ApiState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
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
    setError("");
    const response = await fetch(apiPath("/api/state"), { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    setState(await response.json());
  }

  async function mutate<T>(label: string, path: string, body?: unknown): Promise<T> {
    setBusy(label);
    setError("");
    try {
      const response = await fetchWithRenderRetry(apiPath(path), {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!response.ok) throw new Error(response.errorText);
      const payload = (await response.json()) as T;
      await refresh();
      return payload;
    } catch (event) {
      setError(event instanceof Error ? event.message : "Request failed");
      throw event;
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    refresh().catch((event) => {
      setError(event instanceof Error ? event.message : "Could not load Forge state");
    });
  }, []);

  const activeRun = state?.runs[0];
  const activeSession = activeRun
    ? state?.sessions.find((session) => session.id === activeRun.sessionId)
    : state?.sessions[0];
  const latestCheckpoint = state?.checkpoints[0];
  const activeRecipe = recipes[activeSession?.recipe ?? sessionForm.recipe];
  const runPercent = activeRun
    ? Math.min(100, Math.round((activeRun.step / activeRun.targetSteps) * 100))
    : 0;

  const metrics = useMemo(() => {
    const runs = state?.runs ?? [];
    const tokens = runs.reduce((sum, run) => sum + run.tokens, 0);
    const spend = runs.reduce((sum, run) => sum + run.costUsd, 0);
    const bestVerifier = Math.max(0, ...runs.map((run) => run.verifierScore));

    return [
      {
        label: "Active sessions",
        value: state?.sessions.length ?? 0,
        hint: "LoRA workspaces",
        icon: FlaskConical,
        tone: "green"
      },
      {
        label: "Training tokens",
        value: tokens.toLocaleString(),
        hint: "forward_backward total",
        icon: Cpu,
        tone: "blue"
      },
      {
        label: "Best verifier",
        value: bestVerifier.toFixed(2),
        hint: "promotion signal",
        icon: ShieldCheck,
        tone: "violet"
      },
      {
        label: "Spend",
        value: `$${spend.toFixed(2)}`,
        hint: "mock cost ledger",
        icon: Gauge,
        tone: "amber"
      }
    ];
  }, [state]);

  if (!state) {
    return (
      <main className="loading-shell">
        <div className="brand-lockup">
          <div className="brand-mark">F</div>
          <div>
            <strong>Forge</strong>
            <span>Loading control plane</span>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand-lockup" href="#top" aria-label="Forge home">
          <div className="brand-mark">F</div>
          <div>
            <strong>Forge</strong>
            <span>{state.project.organization}</span>
          </div>
        </a>

        <nav className="side-nav" aria-label="Primary navigation">
          {nav.map(([label, target, Icon]) => (
            <a href={`#${target}`} key={label}>
              <Icon size={16} />
              {label}
            </a>
          ))}
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-top">
            <span>Project</span>
            <CheckCircle2 size={15} />
          </div>
          <strong>{state.project.name}</strong>
          <p>{activeRecipe.objective}</p>
        </div>

        <div className="sidebar-footer">
          <ProviderBadge name="Modal" mode={state.providers.modal} />
          <ProviderBadge name="Baseten" mode={state.providers.baseten} />
        </div>
      </aside>

      <main className="workspace" id="top">
        <header className="topbar">
          <div>
            <span className="kicker">Post-training control plane</span>
            <h1>{state.project.name}</h1>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              onClick={async () => {
                setBusy("reset");
                setError("");
                try {
                  await fetch(apiPath("/api/state"), { method: "DELETE" });
                  await refresh();
                } catch (event) {
                  setError(event instanceof Error ? event.message : "Reset failed");
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy !== null}
              title="Reset demo state"
              aria-label="Reset demo state"
            >
              <RotateCcw size={17} />
            </button>
            <button
              className="button primary"
              onClick={() => mutate("new-session", "/api/sessions", sessionForm)}
              disabled={busy !== null}
            >
              <Play size={16} />
              New session
            </button>
          </div>
        </header>

        {error ? <p className="error-text">{error}</p> : null}

        <section className="overview-grid" aria-label="Project overview">
          <div className="hero-panel">
            <div className="panel-topline">
              <span>Active recipe</span>
              <StatusPill status={activeRun?.status ?? "ready"} />
            </div>
            <div className="hero-content">
              <div>
                <h2>{activeRecipe.name}</h2>
                <p>{activeRecipe.description}</p>
              </div>
              <div className="command-card" aria-label="Example Forge command">
                <TerminalSquare size={16} />
                <code>forge run {sessionForm.recipe} --model {sessionForm.model}</code>
              </div>
            </div>

            <div className="pipeline-strip" aria-label="Pipeline stages">
              {pipeline.map(([label, Icon], index) => (
                <div className="pipeline-step" key={label}>
                  <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
                  <Icon size={16} />
                  <strong>{label}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="run-panel">
            <div className="panel-topline">
              <span>Current run</span>
              <span>{runPercent}% complete</span>
            </div>
            <h2>{activeRun?.name ?? "No active run"}</h2>
            <Progress value={runPercent} />
            <div className="run-kpis">
              <MiniKpi label="Step" value={activeRun ? `${activeRun.step}/${activeRun.targetSteps}` : "0"} />
              <MiniKpi label="Loss" value={activeRun?.loss ?? 0} />
              <MiniKpi label="Reward" value={activeRun?.reward ?? 0} />
              <MiniKpi label="Verifier" value={activeRun?.verifierScore ?? 0} />
            </div>
          </div>

          <div className="activity-panel">
            <div className="panel-topline">
              <span>Activity 24h</span>
              <LineChart size={16} />
            </div>
            <div className="bar-chart" aria-label="Synthetic activity chart">
              {activityBars.map((height, index) => (
                <i style={{ height: `${height}%` }} key={`${height}-${index}`} />
              ))}
            </div>
            <div className="chart-legend">
              <span>rollouts</span>
              <span>verifier calls</span>
              <span>checkpoints</span>
            </div>
          </div>
        </section>

        <section className="metric-grid" aria-label="Project metrics">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </section>

        <section className="operations-grid">
          <div className="primary-column">
            <Panel icon={Activity} title="Runs" eyebrow="Training pipeline" id="runs">
              <RunTable
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

            <Panel icon={TerminalSquare} title="Sampler" eyebrow="Adapter output">
              <div className="sampler-grid">
                <label>
                  Prompt
                  <textarea
                    value={recipes[activeSession?.recipe ?? "chat-sft"].defaultPrompt}
                    readOnly
                  />
                </label>
                <div>
                  <button
                    className="button secondary full-width"
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
                    <Sparkles size={16} />
                    Sample adapter
                  </button>
                  <div className="terminal">{sample || "Sampler output will appear here."}</div>
                </div>
              </div>
            </Panel>
          </div>

          <div className="secondary-column">
            <Panel icon={FlaskConical} title="Create Session" eyebrow="Project workspace">
              <div className="session-form">
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
            </Panel>

            <Panel icon={BrainCircuit} title="Verifier" eyebrow="Reward primitive" id="verifier">
              <div className="form-stack">
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
                  className="button primary full-width"
                  disabled={busy !== null}
                  onClick={() => mutate("verify", "/api/verify", { candidate, rubric })}
                >
                  <Zap size={16} />
                  Verify candidate
                </button>
                <ScoreList scores={state.verifierScores} />
              </div>
            </Panel>

            <Panel icon={Archive} title="Lineage" eyebrow="Checkpoints" id="checkpoints">
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

            <Panel icon={Cloud} title="Deployments" eyebrow="Serving" id="deployments">
              <DeploymentList deployments={state.deployments} providers={state.providers} />
              {!latestCheckpoint ? null : (
                <p className="helper-copy">
                  Latest checkpoint is promotion-ready. Provider keys are detected from environment
                  variables.
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

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: IconComponent;
  tone: string;
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={16} />
      </div>
      <strong>{value}</strong>
      <p>{hint}</p>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  eyebrow,
  id,
  children
}: {
  icon: IconComponent;
  title: string;
  eyebrow: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel" id={id}>
      <div className="panel-header">
        <div>
          <span>{eyebrow}</span>
          <h2>
            <Icon size={18} />
            {title}
          </h2>
        </div>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function ProviderBadge({ name, mode }: { name: string; mode: "mock" | "configured" }) {
  return (
    <span className={`provider-badge ${mode === "configured" ? "configured" : ""}`}>
      <Database size={14} />
      {name} {mode}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === "completed" || status === "ready" ? "green" : "blue";
  return (
    <span className={`pill ${tone}`}>
      <CheckCircle2 size={13} />
      {status}
    </span>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="progress" aria-label={`${value}% complete`}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="mini-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RunTable({
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
  if (runs.length === 0) return <div className="empty">No runs yet.</div>;

  return (
    <div className="run-table">
      <div className="table-head">
        <span>Run</span>
        <span>Status</span>
        <span>Progress</span>
        <span>Verifier</span>
        <span>Actions</span>
      </div>
      {runs.map((run) => {
        const session = sessions.find((item) => item.id === run.sessionId);
        const percent = Math.min(100, Math.round((run.step / run.targetSteps) * 100));
        return (
          <article className="table-row" key={run.id}>
            <div className="run-name">
              <strong>{run.name}</strong>
              <span>
                {session?.model} / {session ? recipes[session.recipe].name : "recipe"}
              </span>
            </div>
            <StatusPill status={run.status} />
            <div className="progress-cell">
              <Progress value={percent} />
              <span>
                step {run.step}/{run.targetSteps}
              </span>
            </div>
            <div className="score-cell">
              <strong>{run.verifierScore}</strong>
              <span>loss {run.loss} / reward {run.reward}</span>
            </div>
            <div className="row-actions">
              <button
                className="icon-button"
                disabled={busy !== null}
                onClick={() => onForward(run)}
                title="Run forward_backward"
                aria-label="Run forward_backward"
              >
                <GitBranch size={16} />
              </button>
              <button
                className="icon-button"
                disabled={busy !== null}
                onClick={() => onOptim(run)}
                title="Run optim_step"
                aria-label="Run optim_step"
              >
                <Layers3 size={16} />
              </button>
              <button
                className="icon-button"
                disabled={busy !== null}
                onClick={() => onCheckpoint(run)}
                title="Save checkpoint"
                aria-label="Save checkpoint"
              >
                <Save size={16} />
              </button>
            </div>
            <div className="terminal compact">{run.logs.slice(0, 4).join("\n")}</div>
          </article>
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
          <span className="score-value">{score.score.toFixed(2)}</span>
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
    <div className="stack-list">
      {checkpoints.slice(0, 5).map((checkpoint) => (
        <article className="compact-row" key={checkpoint.id}>
          <div>
            <div className="row-title">{checkpoint.name}</div>
            <div className="muted">
              step {checkpoint.step} / {checkpoint.adapterType} / score {checkpoint.score}
            </div>
          </div>
          <button
            className="icon-button"
            disabled={busy !== null}
            onClick={() => onDeploy(checkpoint)}
            title="Deploy checkpoint"
            aria-label="Deploy checkpoint"
          >
            <Cloud size={16} />
          </button>
          <code>{checkpoint.artifactUri}</code>
        </article>
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
    <div className="form-stack">
      <div className="provider-grid">
        <ProviderBadge name="Modal" mode={providers.modal} />
        <ProviderBadge name="Baseten" mode={providers.baseten} />
      </div>
      {deployments.length === 0 ? (
        <div className="empty">No deployments yet.</div>
      ) : (
        <div className="stack-list">
          {deployments.map((deployment) => (
            <article className="compact-row" key={deployment.id}>
              <div>
                <div className="row-title">
                  {deployment.target}
                  <ArrowUpRight size={14} />
                </div>
                <div className="muted">{deployment.endpointUrl}</div>
              </div>
              <span className={`pill ${deployment.mode === "configured" ? "green" : "yellow"}`}>
                {deployment.status} / {deployment.mode}
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
