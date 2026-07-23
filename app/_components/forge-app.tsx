"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Zap
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
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

type SessionForm = {
  name: string;
  model: string;
  recipe: RecipeId;
  targetSteps: number;
};

type ForgeContextValue = {
  state: ApiState | null;
  busy: string | null;
  error: string;
  sample: string;
  candidate: string;
  rubric: string;
  sessionForm: SessionForm;
  activeRun?: TrainingRun;
  activeSession?: Session;
  activeRecipe: (typeof recipes)[RecipeId];
  latestCheckpoint?: Checkpoint;
  metrics: Metric[];
  runPercent: number;
  refresh: () => Promise<void>;
  mutate: <T>(label: string, path: string, body?: unknown) => Promise<T>;
  resetState: () => Promise<void>;
  setSample: (value: string) => void;
  setCandidate: (value: string) => void;
  setRubric: (value: string) => void;
  setSessionForm: (value: SessionForm) => void;
};

type Metric = {
  label: string;
  value: string | number;
  hint: string;
  icon: IconComponent;
  tone: "green" | "blue" | "violet" | "amber";
};

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
const apiPath = (path: string) => `${apiBase}${path}`;

const nav = [
  ["Overview", "/", Gauge],
  ["Runs", "/runs", Activity],
  ["Sessions", "/sessions", FlaskConical],
  ["Verifier", "/verifier", BrainCircuit],
  ["Lineage", "/checkpoints", Archive],
  ["Serving", "/deployments", Cloud]
] as const;

const pageMeta: Record<string, { title: string; eyebrow: string }> = {
  "/": { title: "Command center", eyebrow: "Post-training control plane" },
  "/runs": { title: "Training runs", eyebrow: "Pipeline operations" },
  "/sessions": { title: "Sessions", eyebrow: "Project workspaces" },
  "/verifier": { title: "Verifier", eyebrow: "Reward primitive" },
  "/checkpoints": { title: "Lineage", eyebrow: "Checkpoint registry" },
  "/deployments": { title: "Serving", eyebrow: "Deployment control" }
};

const pipeline = [
  ["Session", FlaskConical],
  ["Rollout", Activity],
  ["Reward", BrainCircuit],
  ["State", Archive],
  ["Serve", Cloud]
] as const;

const activityBars = [42, 48, 37, 63, 58, 72, 67, 81, 76, 88, 79, 92, 84, 74, 86, 69];

const ForgeContext = createContext<ForgeContextValue | null>(null);

export function ForgeShell({ children }: { children: React.ReactNode }) {
  return (
    <ForgeProvider>
      <ShellChrome>{children}</ShellChrome>
    </ForgeProvider>
  );
}

function ForgeProvider({ children }: { children: React.ReactNode }) {
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
  const [sessionForm, setSessionForm] = useState<SessionForm>({
    name: "math verifier run",
    model: "qwen3-8b",
    recipe: "math-rl",
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

  async function resetState() {
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

  const metrics = useMemo<Metric[]>(() => {
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

  const value: ForgeContextValue = {
    state,
    busy,
    error,
    sample,
    candidate,
    rubric,
    sessionForm,
    activeRun,
    activeSession,
    activeRecipe,
    latestCheckpoint,
    metrics,
    runPercent,
    refresh,
    mutate,
    resetState,
    setSample,
    setCandidate,
    setRubric,
    setSessionForm
  };

  return <ForgeContext.Provider value={value}>{children}</ForgeContext.Provider>;
}

function ShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const forge = useForge();
  const meta = pageMeta[pathname] ?? pageMeta["/"];
  const org = forge.state?.project.organization ?? "Forge";
  const projectName = forge.state?.project.name ?? "Loading project";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup" aria-label="Forge home">
          <div className="brand-mark">F</div>
          <div>
            <strong>Forge</strong>
            <span>{org}</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="Primary navigation">
          {nav.map(([label, href, Icon]) => {
            const active = pathname === href;
            return (
              <Link href={href} key={href} className={active ? "active" : undefined}>
                <Icon size={16} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-top">
            <span>Project</span>
            <CheckCircle2 size={15} />
          </div>
          <strong>{projectName}</strong>
          <p>{forge.activeRecipe.objective}</p>
        </div>

        <div className="sidebar-footer">
          <ProviderBadge name="Modal" mode={forge.state?.providers.modal ?? "mock"} />
          <ProviderBadge name="Baseten" mode={forge.state?.providers.baseten ?? "mock"} />
        </div>
      </aside>

      <div className="workspace-shell">
        <header className="topbar">
          <div className="topbar-title">
            <span className="kicker">{meta.eyebrow}</span>
            <h1>{meta.title}</h1>
          </div>
          <div className="topbar-search" role="search">
            <Search size={15} />
            <span>Search runs, checkpoints, deployments</span>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              onClick={forge.resetState}
              disabled={forge.busy !== null}
              title="Reset demo state"
              aria-label="Reset demo state"
            >
              <RotateCcw size={17} />
            </button>
            <button
              className="button primary"
              onClick={() => forge.mutate("new-session", "/api/sessions", forge.sessionForm)}
              disabled={forge.busy !== null}
            >
              <Play size={16} />
              New session
            </button>
          </div>
        </header>

        <main className="workspace-scroll">
          {forge.error ? <p className="error-text">{forge.error}</p> : null}
          {!forge.state ? <LoadingState /> : children}
        </main>
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { state, activeRecipe, activeRun, runPercent, sessionForm, metrics, latestCheckpoint } =
    useReadyForge();

  return (
    <div className="page-stack">
      <section className="overview-band">
        <div className="overview-copy">
          <span className="kicker">Active recipe</span>
          <h2>{activeRecipe.name}</h2>
          <p>{activeRecipe.description}</p>
          <div className="command-card" aria-label="Example Forge command">
            <TerminalSquare size={16} />
            <code>forge run {sessionForm.recipe} --model {sessionForm.model}</code>
          </div>
        </div>
        <div className="run-focus">
          <div className="panel-topline">
            <span>Current run</span>
            <span>{runPercent}% complete</span>
          </div>
          <h3>{activeRun?.name ?? "No active run"}</h3>
          <Progress value={runPercent} />
          <div className="run-kpis">
            <MiniKpi label="Step" value={activeRun ? `${activeRun.step}/${activeRun.targetSteps}` : "0"} />
            <MiniKpi label="Loss" value={activeRun?.loss ?? 0} />
            <MiniKpi label="Reward" value={activeRun?.reward ?? 0} />
            <MiniKpi label="Verifier" value={activeRun?.verifierScore ?? 0} />
          </div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Project metrics">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="dashboard-grid">
        <Panel icon={LineChart} title="Activity" eyebrow="24h control plane">
          <ActivityChart />
        </Panel>
        <Panel icon={Activity} title="Recent runs" eyebrow="Training pipeline">
          <RunTable runs={state.runs.slice(0, 4)} sessions={state.sessions} compact />
        </Panel>
        <Panel icon={Archive} title="Promotion queue" eyebrow="Lineage">
          <CheckpointList checkpoints={state.checkpoints.slice(0, 4)} compact />
        </Panel>
        <Panel icon={Cloud} title="Serving status" eyebrow="Deployments">
          <DeploymentList deployments={state.deployments.slice(0, 4)} providers={state.providers} />
          {latestCheckpoint ? (
            <p className="helper-copy">Latest checkpoint is ready for promotion to a serving target.</p>
          ) : null}
        </Panel>
      </section>

      <section className="pipeline-strip" aria-label="Pipeline stages">
        {pipeline.map(([label, Icon], index) => (
          <div className="pipeline-step" key={label}>
            <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
            <Icon size={16} />
            <strong>{label}</strong>
          </div>
        ))}
      </section>
    </div>
  );
}

export function RunsPage() {
  const forge = useReadyForge();
  const activePrompt = recipes[forge.activeSession?.recipe ?? "chat-sft"].defaultPrompt;

  return (
    <div className="page-grid split">
      <section className="page-main">
        <Panel icon={Activity} title="Runs" eyebrow="Training operations">
          <RunTable
            runs={forge.state.runs}
            sessions={forge.state.sessions}
            busy={forge.busy}
            onForward={(run) =>
              forge.mutate("forward", `/api/v1/training-runs/${run.id}/forward-backward`, {
                microbatches: 4
              })
            }
            onOptim={(run) => forge.mutate("optim", `/api/v1/training-runs/${run.id}/optim-step`, {})}
            onCheckpoint={(run) =>
              forge.mutate("checkpoint", "/api/v1/checkpoints", { runId: run.id })
            }
          />
        </Panel>
      </section>

      <aside className="page-rail">
        <Panel icon={TerminalSquare} title="Sampler" eyebrow="Adapter output">
          <div className="form-stack">
            <label>
              Prompt
              <textarea value={activePrompt} readOnly />
            </label>
            <button
              className="button secondary full-width"
              disabled={!forge.activeSession || forge.busy !== null}
              onClick={async () => {
                if (!forge.activeSession) return;
                const result = await forge.mutate<{ output: string }>("/sample", "/api/sample", {
                  sessionId: forge.activeSession.id,
                  prompt: recipes[forge.activeSession.recipe].defaultPrompt
                });
                forge.setSample(result.output);
              }}
            >
              <Sparkles size={16} />
              Sample adapter
            </button>
            <div className="terminal">{forge.sample || "Sampler output will appear here."}</div>
          </div>
        </Panel>
      </aside>
    </div>
  );
}

export function SessionsPage() {
  const forge = useReadyForge();

  return (
    <div className="page-grid split">
      <section className="page-main">
        <Panel icon={Server} title="Sessions" eyebrow="Workspace inventory">
          <SessionTable sessions={forge.state.sessions} />
        </Panel>
      </section>

      <aside className="page-rail">
        <Panel icon={FlaskConical} title="Create session" eyebrow="Project workspace">
          <SessionFormPanel />
        </Panel>
      </aside>
    </div>
  );
}

export function VerifierPage() {
  const forge = useReadyForge();

  return (
    <div className="page-grid split">
      <section className="page-main">
        <Panel icon={BrainCircuit} title="Verifier scores" eyebrow="Reward history">
          <ScoreList scores={forge.state.verifierScores} expanded />
        </Panel>
      </section>

      <aside className="page-rail">
        <Panel icon={Zap} title="Score candidate" eyebrow="Verifier workbench">
          <div className="form-stack">
            <label>
              Rubric
              <textarea value={forge.rubric} onChange={(event) => forge.setRubric(event.target.value)} />
            </label>
            <label>
              Candidate
              <textarea
                value={forge.candidate}
                onChange={(event) => forge.setCandidate(event.target.value)}
              />
            </label>
            <button
              className="button primary full-width"
              disabled={forge.busy !== null}
              onClick={() => forge.mutate("verify", "/api/verify", { candidate: forge.candidate, rubric: forge.rubric })}
            >
              <Zap size={16} />
              Verify candidate
            </button>
          </div>
        </Panel>
      </aside>
    </div>
  );
}

export function CheckpointsPage() {
  const forge = useReadyForge();

  return (
    <div className="page-stack">
      <Panel icon={Archive} title="Checkpoints" eyebrow="Lineage registry">
        <CheckpointList
          checkpoints={forge.state.checkpoints}
          busy={forge.busy}
          onDeploy={(checkpoint) =>
            forge.mutate("deploy", "/api/v1/deployments", {
              checkpointId: checkpoint.id,
              target: "baseten"
            })
          }
        />
      </Panel>
    </div>
  );
}

export function DeploymentsPage() {
  const forge = useReadyForge();

  return (
    <div className="page-grid split">
      <section className="page-main">
        <Panel icon={Cloud} title="Deployments" eyebrow="Serving endpoints">
          <DeploymentList deployments={forge.state.deployments} providers={forge.state.providers} expanded />
        </Panel>
      </section>

      <aside className="page-rail">
        <Panel icon={Database} title="Provider health" eyebrow="Runtime configuration">
          <div className="provider-grid vertical">
            <ProviderBadge name="Modal" mode={forge.state.providers.modal} />
            <ProviderBadge name="Baseten" mode={forge.state.providers.baseten} />
            <ProviderBadge name="Supabase" mode={forge.state.providers.supabase} />
          </div>
          <p className="helper-copy">Provider status reflects configured environment variables.</p>
        </Panel>
      </aside>
    </div>
  );
}

function SessionFormPanel() {
  const forge = useReadyForge();
  const { sessionForm } = forge;

  return (
    <div className="session-form">
      <label>
        Session name
        <input
          value={sessionForm.name}
          onChange={(event) => forge.setSessionForm({ ...sessionForm, name: event.target.value })}
        />
      </label>
      <label>
        Model
        <select
          value={sessionForm.model}
          onChange={(event) => forge.setSessionForm({ ...sessionForm, model: event.target.value })}
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
            forge.setSessionForm({
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
            forge.setSessionForm({
              ...sessionForm,
              targetSteps: Number(event.target.value)
            })
          }
        />
      </label>
      <button
        className="button primary full-width"
        onClick={() => forge.mutate("new-session", "/api/sessions", sessionForm)}
        disabled={forge.busy !== null}
      >
        <Play size={16} />
        Start session
      </button>
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

function useForge() {
  const value = useContext(ForgeContext);
  if (!value) throw new Error("useForge must be used inside ForgeProvider");
  return value;
}

function useReadyForge() {
  const forge = useForge();
  if (!forge.state) throw new Error("Forge state was requested before it loaded");
  return forge as ForgeContextValue & { state: ApiState };
}

function LoadingState() {
  return (
    <div className="loading-shell">
      <div className="brand-lockup">
        <div className="brand-mark">F</div>
        <div>
          <strong>Forge</strong>
          <span>Loading control plane</span>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, hint, icon: Icon, tone }: Metric) {
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
  children
}: {
  icon: IconComponent;
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
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
  const tone = status === "completed" || status === "ready" ? "green" : status === "failed" ? "red" : "blue";
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

function ActivityChart() {
  return (
    <>
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
    </>
  );
}

function SessionTable({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) return <div className="empty">No sessions yet.</div>;

  return (
    <div className="data-table sessions-table">
      <div className="table-head">
        <span>Session</span>
        <span>Model</span>
        <span>Recipe</span>
        <span>Provider</span>
      </div>
      {sessions.map((session) => (
        <article className="table-row" key={session.id}>
          <div className="cell-title">
            <strong>{session.name}</strong>
            <span>{session.id}</span>
          </div>
          <span>{session.model}</span>
          <span>{recipes[session.recipe].name}</span>
          <ProviderBadge name={session.provider} mode="configured" />
        </article>
      ))}
    </div>
  );
}

function RunTable({
  runs,
  sessions,
  busy,
  compact = false,
  onForward,
  onOptim,
  onCheckpoint
}: {
  runs: TrainingRun[];
  sessions: Session[];
  busy?: string | null;
  compact?: boolean;
  onForward?: (run: TrainingRun) => void;
  onOptim?: (run: TrainingRun) => void;
  onCheckpoint?: (run: TrainingRun) => void;
}) {
  if (runs.length === 0) return <div className="empty">No runs yet.</div>;

  return (
    <div className={`data-table runs-table ${compact ? "compact-table" : ""}`}>
      <div className="table-head">
        <span>Run</span>
        <span>Status</span>
        <span>Progress</span>
        <span>Verifier</span>
        {!compact ? <span>Actions</span> : null}
      </div>
      {runs.map((run) => {
        const session = sessions.find((item) => item.id === run.sessionId);
        const percent = Math.min(100, Math.round((run.step / run.targetSteps) * 100));
        return (
          <article className="table-row" key={run.id}>
            <div className="cell-title">
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
            {!compact ? (
              <div className="row-actions">
                <button
                  className="icon-button"
                  disabled={busy !== null}
                  onClick={() => onForward?.(run)}
                  title="Run forward_backward"
                  aria-label="Run forward_backward"
                >
                  <GitBranch size={16} />
                </button>
                <button
                  className="icon-button"
                  disabled={busy !== null}
                  onClick={() => onOptim?.(run)}
                  title="Run optim_step"
                  aria-label="Run optim_step"
                >
                  <Layers3 size={16} />
                </button>
                <button
                  className="icon-button"
                  disabled={busy !== null}
                  onClick={() => onCheckpoint?.(run)}
                  title="Save checkpoint"
                  aria-label="Save checkpoint"
                >
                  <Save size={16} />
                </button>
              </div>
            ) : null}
            {!compact ? <div className="terminal compact">{run.logs.slice(0, 4).join("\n")}</div> : null}
          </article>
        );
      })}
    </div>
  );
}

function ScoreList({ scores, expanded = false }: { scores: VerifierScore[]; expanded?: boolean }) {
  if (scores.length === 0) return <div className="empty">No verifier scores yet.</div>;
  return (
    <div className="score-list">
      {scores.slice(0, expanded ? 12 : 4).map((score) => (
        <article className="score-row" key={score.id}>
          <span className="score-value">{score.score.toFixed(2)}</span>
          <div>
            <div>{score.candidate.slice(0, expanded ? 180 : 110)}</div>
            <div className="muted">
              confidence {score.confidence.toFixed(2)} / {score.rationale}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function CheckpointList({
  checkpoints,
  busy,
  compact = false,
  onDeploy
}: {
  checkpoints: Checkpoint[];
  busy?: string | null;
  compact?: boolean;
  onDeploy?: (checkpoint: Checkpoint) => void;
}) {
  if (checkpoints.length === 0) return <div className="empty">No checkpoints yet.</div>;
  return (
    <div className={`data-table checkpoints-table ${compact ? "compact-table" : ""}`}>
      <div className="table-head">
        <span>Checkpoint</span>
        <span>Step</span>
        <span>Score</span>
        {!compact ? <span>Artifact</span> : null}
        {!compact ? <span>Action</span> : null}
      </div>
      {checkpoints.map((checkpoint) => (
        <article className="table-row" key={checkpoint.id}>
          <div className="cell-title">
            <strong>{checkpoint.name}</strong>
            <span>{checkpoint.adapterType}</span>
          </div>
          <span>{checkpoint.step}</span>
          <span className="mono-value">{checkpoint.score}</span>
          {!compact ? <code>{checkpoint.artifactUri}</code> : null}
          {!compact ? (
            <button
              className="icon-button"
              disabled={busy !== null}
              onClick={() => onDeploy?.(checkpoint)}
              title="Deploy checkpoint"
              aria-label="Deploy checkpoint"
            >
              <Cloud size={16} />
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function DeploymentList({
  deployments,
  providers,
  expanded = false
}: {
  deployments: Deployment[];
  providers: ProviderHealth;
  expanded?: boolean;
}) {
  return (
    <div className="form-stack">
      {!expanded ? (
        <div className="provider-grid">
          <ProviderBadge name="Modal" mode={providers.modal} />
          <ProviderBadge name="Baseten" mode={providers.baseten} />
        </div>
      ) : null}
      {deployments.length === 0 ? (
        <div className="empty">No deployments yet.</div>
      ) : (
        <div className="data-table deployments-table">
          <div className="table-head">
            <span>Target</span>
            <span>Status</span>
            <span>Endpoint</span>
          </div>
          {deployments.map((deployment) => (
            <article className="table-row" key={deployment.id}>
              <div className="cell-title">
                <strong>
                  {deployment.target}
                  <ArrowUpRight size={14} />
                </strong>
                <span>{deployment.id}</span>
              </div>
              <span className={`pill ${deployment.mode === "configured" ? "green" : "yellow"}`}>
                {deployment.status} / {deployment.mode}
              </span>
              <span className="truncate">{deployment.endpointUrl}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
