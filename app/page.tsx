"use client";

import {
  Activity,
  Archive,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Cpu,
  Database,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers3,
  Play,
  RotateCcw,
  Save,
  Server,
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
  ["Runs", Activity],
  ["Verifier", BrainCircuit],
  ["Checkpoints", Archive],
  ["Deployments", Cloud]
] as const;

const pipeline = [
  ["Sessions", FlaskConical],
  ["Runs", Activity],
  ["Verifier", BrainCircuit],
  ["Checkpoints", Archive],
  ["Serving", Cloud]
] as const;

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

  const metrics = useMemo(() => {
    const runs = state?.runs ?? [];
    return [
      {
        label: "Sessions",
        value: state?.sessions.length ?? 0,
        hint: "LoRA workspaces",
        icon: FlaskConical
      },
      {
        label: "Training tokens",
        value: runs.reduce((sum, run) => sum + run.tokens, 0).toLocaleString(),
        hint: "forward_backward total",
        icon: Cpu
      },
      {
        label: "Best verifier",
        value: Math.max(0, ...runs.map((run) => run.verifierScore)).toFixed(2),
        hint: "promotion signal",
        icon: ShieldCheck
      },
      {
        label: "Spend",
        value: `$${runs.reduce((sum, run) => sum + run.costUsd, 0).toFixed(2)}`,
        hint: "mock cost ledger",
        icon: Gauge
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

  const runPercent = activeRun
    ? Math.min(100, Math.round((activeRun.step / activeRun.targetSteps) * 100))
    : 0;

  return (
    <div className="site-shell">
      <header className="site-nav">
        <a className="brand-lockup" href="#top" aria-label="Forge home">
          <div className="brand-mark">F</div>
          <div>
            <strong>Forge</strong>
            <span>{state.project.organization} / {state.project.name}</span>
          </div>
        </a>

        <nav className="nav-links" aria-label="Primary navigation">
          {nav.map(([label, Icon]) => (
            <a href={`#${label.toLowerCase()}`} key={label}>
              <Icon size={15} />
              {label}
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          <ProviderBadge name="Modal" mode={state.providers.modal} />
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

      <main id="top">
        <section className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" />
              Post-training infrastructure
            </div>
            <h1>Forge</h1>
            <p className="hero-subhead">
              A programmable control plane for LoRA sessions, verifier-scored rollouts,
              checkpoint lineage, and adapter promotion.
            </p>

            <div className="command-bar" aria-label="Example Forge command">
              <TerminalSquare size={17} />
              <code>forge run {sessionForm.recipe} --model {sessionForm.model}</code>
            </div>

            <div className="hero-actions">
              <button
                className="button primary"
                onClick={() => mutate("new-session", "/api/sessions", sessionForm)}
                disabled={busy !== null}
              >
                <Play size={16} />
                Start run
              </button>
              <a className="button secondary" href="#runs">
                Inspect pipeline
                <ChevronRight size={16} />
              </a>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
          </div>

          <div className="control-stage" aria-label="Forge control plane preview">
            <div className="stage-header">
              <div>
                <span>Active recipe</span>
                <strong>{recipes[activeSession?.recipe ?? "chat-sft"].name}</strong>
              </div>
              <span className={`pill ${activeRun?.status === "completed" ? "green" : "blue"}`}>
                <CheckCircle2 size={13} />
                {activeRun?.status ?? "ready"}
              </span>
            </div>

            <div className="pipeline-map">
              {pipeline.map(([label, Icon], index) => (
                <div className="pipeline-node" key={label}>
                  <span className="node-icon">
                    <Icon size={16} />
                  </span>
                  <span>{label}</span>
                  {index < pipeline.length - 1 ? <i /> : null}
                </div>
              ))}
            </div>

            <div className="stage-grid">
              <div className="runtime-card">
                <div className="runtime-title">
                  <Server size={16} />
                  Training run
                </div>
                <strong>{activeRun?.name ?? "No active run"}</strong>
                <div className="progress large" aria-label={`${runPercent}% complete`}>
                  <span style={{ width: `${runPercent}%` }} />
                </div>
                <div className="runtime-meta">
                  <span>{activeRun ? `${activeRun.step}/${activeRun.targetSteps} steps` : "0 steps"}</span>
                  <span>{activeRun ? `${activeRun.verifierScore} verifier` : "0 verifier"}</span>
                </div>
              </div>

              <div className="code-card">
                <div>reward: {activeRun?.reward ?? 0}</div>
                <div>loss: {activeRun?.loss ?? 0}</div>
                <div>checkpoint: {latestCheckpoint?.name ?? "pending"}</div>
                <div>target: {state.deployments[0]?.target ?? "baseten"}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="metric-strip" aria-label="Project metrics">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </section>

        <section className="console-grid">
          <div className="left-rail">
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

            <Panel icon={TerminalSquare} title="Sampler" eyebrow="Adapter output">
              <div className="form-grid">
                <label>
                  Prompt
                  <textarea
                    value={recipes[activeSession?.recipe ?? "chat-sft"].defaultPrompt}
                    readOnly
                  />
                </label>
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
                  Sample current adapter
                </button>
                <div className="terminal">{sample || "Sampler output will appear here."}</div>
              </div>
            </Panel>
          </div>

          <div className="main-rail">
            <Panel icon={Activity} title="Runs" eyebrow="Training pipeline" id="runs">
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
          </div>

          <div className="right-rail">
            <Panel icon={BrainCircuit} title="Verifier" eyebrow="Reward primitive" id="verifier">
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

            <Panel icon={Archive} title="Checkpoints" eyebrow="Lineage" id="checkpoints">
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
                  Latest checkpoint is promotion-ready. Modal and Baseten keys are detected from
                  environment variables.
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
  icon: Icon
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: IconComponent;
}) {
  return (
    <div className="metric-card">
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
  if (runs.length === 0) return <div className="empty">No runs yet.</div>;

  return (
    <div className="run-list">
      {runs.map((run) => {
        const session = sessions.find((item) => item.id === run.sessionId);
        const percent = Math.min(100, Math.round((run.step / run.targetSteps) * 100));
        return (
          <article className="run-row" key={run.id}>
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
              <span style={{ width: `${percent}%` }} />
            </div>

            <div className="run-stats">
              <span>step {run.step}/{run.targetSteps}</span>
              <span>loss {run.loss}</span>
              <span>reward {run.reward}</span>
              <span>verifier {run.verifierScore}</span>
            </div>

            <div className="run-actions">
              <button className="button secondary" disabled={busy !== null} onClick={() => onForward(run)}>
                <GitBranch size={16} />
                forward_backward
              </button>
              <button className="button secondary" disabled={busy !== null} onClick={() => onOptim(run)}>
                <Layers3 size={16} />
                optim_step
              </button>
              <button
                className="button secondary"
                disabled={busy !== null}
                onClick={() => onCheckpoint(run)}
              >
                <Save size={16} />
                save_state
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
          <button className="icon-button" disabled={busy !== null} onClick={() => onDeploy(checkpoint)}>
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
    <div className="form-grid">
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
                <div className="row-title">{deployment.target}</div>
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
