"use client";

import Link from "next/link";
import {
  Activity,
  Archive,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Cloud,
  Database,
  ExternalLink,
  FileUp,
  FlaskConical,
  GitBranch,
  Layers3,
  Link2,
  Play,
  Power,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Trash2,
  UserRound,
  Zap
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState
} from "react";
import { models, recipes } from "@/lib/recipes";
import type { SafeAccountSummary } from "@/lib/account";
import { ProviderOnboardingDialog } from "@/app/(dashboard)/account/provider-settings-form";
import type {
  Checkpoint,
  Dataset,
  DatasetAdapter,
  Deployment,
  ForgeState,
  ProviderHealth,
  RecipeId,
  Session,
  TrainingRun,
  VerifierScore
} from "@/lib/types";
import { AnvilLogo } from "@/app/_components/anvil-logo";

type ApiState = ForgeState & { providers: ProviderHealth };
type IconComponent = typeof Activity;

type RunForm = {
  name: string;
  model: string;
  recipe: RecipeId;
  datasetId: string;
  targetSteps: number;
};

type ForgeContextValue = {
  state: ApiState | null;
  busy: string | null;
  error: string;
  sample: string;
  candidate: string;
  rubric: string;
  runForm: RunForm;
  activeRun?: TrainingRun;
  activeSession?: Session;
  activeCheckpoint?: Checkpoint;
  selectRun: (runId: string) => void;
  mutate: <T>(label: string, path: string, body?: unknown) => Promise<T>;
  setSample: (value: string) => void;
  setCandidate: (value: string) => void;
  setRubric: (value: string) => void;
  setRunForm: (value: RunForm) => void;
  uploadDataset: (formData: FormData) => Promise<{ dataset: Dataset }>;
  deleteDataset: (datasetId: string) => Promise<void>;
};

const apiPath = (path: string) => path;

const navigation = [
  ["Train", "/runs", Activity],
  ["Data", "/datasets", Database],
  ["Deploy", "/deployments", Cloud],
  ["Evaluate", "/evaluate", BrainCircuit]
] as const;

const pageLabels: Record<string, string> = {
  "/runs": "Train",
  "/datasets": "Data",
  "/evaluate": "Evaluate",
  "/deployments": "Deploy",
  "/account": "Account"
};

const ForgeContext = createContext<ForgeContextValue | null>(null);

export function ForgeShell({
  children,
  initialAccount,
  showOnboarding
}: {
  children: React.ReactNode;
  initialAccount: SafeAccountSummary;
  showOnboarding: boolean;
}) {
  const [account, setAccount] = useState(initialAccount);

  return (
    <ForgeProvider>
      <ShellChrome account={account}>{children}</ShellChrome>
      <ProviderOnboardingDialog
        initialAccount={account}
        showOnboarding={showOnboarding}
        onAccountChange={setAccount}
      />
    </ForgeProvider>
  );
}

function ForgeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ApiState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sample, setSample] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [candidate, setCandidate] = useState(
    "The response follows the task, cites the relevant artifact, and explains why the model is ready to release."
  );
  const [rubric, setRubric] = useState(
    "Score task correctness, evidence quality, clarity, and release readiness."
  );
  const [runForm, setRunForm] = useState<RunForm>({
    name: "Research run",
    model: "sshleifer/tiny-gpt2",
    recipe: "chat-sft",
    datasetId: "",
    targetSteps: 8
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

  async function uploadDataset(formData: FormData) {
    setBusy("dataset-upload");
    setError("");
    try {
      const response = await fetchWithRenderRetry(
        apiPath("/api/v1/datasets/upload"),
        { method: "POST", body: formData }
      );
      if (!response.ok) throw new Error(response.errorText);
      const payload = (await response.json()) as { dataset: Dataset };
      await refresh();
      return payload;
    } catch (event) {
      setError(event instanceof Error ? event.message : "Dataset upload failed");
      throw event;
    } finally {
      setBusy(null);
    }
  }

  async function deleteDataset(datasetId: string) {
    setBusy("dataset-delete");
    setError("");
    try {
      const response = await fetchWithRenderRetry(
        apiPath(`/api/v1/datasets/${datasetId}`),
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error(response.errorText);
      await refresh();
    } catch (event) {
      setError(event instanceof Error ? event.message : "Dataset deletion failed");
      throw event;
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let active = true;

    fetch(apiPath("/api/state"), { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as ApiState;
      })
      .then((payload) => {
        if (active) setState(payload);
      })
      .catch((event) => {
        if (active) {
          setError(event instanceof Error ? event.message : "Could not load Forge");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const activeRun =
    state?.runs.find((run) => run.id === selectedRunId) ?? state?.runs[0];
  const activeSession = activeRun
    ? state?.sessions.find((session) => session.id === activeRun.sessionId)
    : undefined;
  const activeCheckpoint = activeRun
    ? state?.checkpoints.find((checkpoint) => checkpoint.runId === activeRun.id)
    : undefined;

  const value: ForgeContextValue = {
    state,
    busy,
    error,
    sample,
    candidate,
    rubric,
    runForm,
    activeRun,
    activeSession,
    activeCheckpoint,
    selectRun: setSelectedRunId,
    mutate,
    setSample,
    setCandidate,
    setRubric,
    setRunForm,
    uploadDataset,
    deleteDataset
  };

  return <ForgeContext.Provider value={value}>{children}</ForgeContext.Provider>;
}

function ShellChrome({
  children,
  account
}: {
  children: React.ReactNode;
  account: SafeAccountSummary;
}) {
  const pathname = usePathname();
  const forge = useForge();
  const project = forge.state?.project;

  return (
    <div className="forge-shell">
      <aside className="primary-rail">
        <div className="brand-row">
          <Link href="/runs" className="brand-symbol" aria-label="Forge train">
            <AnvilLogo />
          </Link>
          <div className="brand-copy">
            <strong>Forge</strong>
            <span>{account.user.email}</span>
          </div>
        </div>

        <div className="project-context">
          <span>Project</span>
          <strong>{project?.name ?? "Loading project"}</strong>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map(([label, href, Icon]) => {
            const active = pathname === href;
            return (
              <Link href={href} key={href} className={active ? "active" : undefined}>
                <Icon size={16} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="runtime-state">
          <span className="runtime-title">Runtime</span>
          <RuntimeRow name="Training" configured={account.providers.modal} />
          <RuntimeRow
            name="Serving"
            configured={account.providers.modal && account.providers.baseten}
          />
          <RuntimeRow name="Storage" configured={account.providers.storage} />
          <Link className="account-link" href="/account">
            <AccountAvatar
              name={account.user.displayName}
              avatarUrl={account.user.avatarUrl}
            />
            <span>
              <strong>{account.user.displayName}</strong>
              <small>Account & provider keys</small>
            </span>
            <UserRound size={15} />
          </Link>
        </div>
      </aside>

      <div className="product-area">
        <header className="utility-bar">
          <div className="utility-context">
            <span>{project?.name ?? "Forge"}</span>
            <ChevronRight size={14} />
            <strong>{pageLabels[pathname] ?? "Train"}</strong>
          </div>
          <div className="utility-actions">
            <Link
              className="compact-runtime-link"
              href="/account"
              aria-label={[
                `Training: ${account.providers.modal ? "configured" : "not ready"}`,
                `Serving: ${
                  account.providers.modal && account.providers.baseten
                    ? "configured"
                    : "not ready"
                }`,
                `Storage: ${account.providers.storage ? "configured" : "not ready"}`,
                "Open account settings"
              ].join(". ")}
            >
              <span className="compact-runtime-dots" aria-hidden="true">
                <span
                  className={`runtime-dot ${account.providers.modal ? "ready" : ""}`}
                />
                <span
                  className={`runtime-dot ${
                    account.providers.modal && account.providers.baseten
                      ? "ready"
                      : ""
                  }`}
                />
                <span
                  className={`runtime-dot ${account.providers.storage ? "ready" : ""}`}
                />
              </span>
              <span>Account</span>
              <UserRound size={15} />
            </Link>
            <Link className="button primary compact-action" href="/runs#new-run">
              <Play size={15} fill="currentColor" />
              New run
            </Link>
          </div>
        </header>

        <main className="product-scroll">
          {forge.error ? (
            <div className="error-banner" role="alert">
              <CircleAlert size={17} />
              <span>{forge.error}</span>
            </div>
          ) : null}
          {pathname === "/account" ? (
            children
          ) : !forge.state ? (
            <LoadingState />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

export function TrainPage() {
  const forge = useReadyForge();
  const { activeRun, activeSession, activeCheckpoint } = forge;
  const activeDeployment = activeCheckpoint
    ? forge.state.deployments.find(
        (deployment) => deployment.checkpointId === activeCheckpoint.id
      )
    : undefined;
  const activeDataset = activeSession?.datasetId
    ? forge.state.datasets.find(
        (dataset) => dataset.id === activeSession.datasetId
      )
    : undefined;

  const workflow = [
    { label: "Configure", complete: Boolean(activeSession) },
    { label: "Train", complete: activeRun?.status === "completed" },
    {
      label: "Evaluate",
      complete:
        Boolean(
          activeRun &&
            (activeRun.verifierScore >= 0.4 || activeDeployment)
        )
    },
    { label: "Save", complete: Boolean(activeCheckpoint) },
    { label: "Deploy", complete: Boolean(activeDeployment) }
  ];
  const currentStage = Math.max(
    0,
    workflow.findIndex((stage) => !stage.complete)
  );

  async function trainNextBatch() {
    if (!activeRun) return;
    try {
      await forge.mutate(
        "training",
        `/api/v1/training-runs/${activeRun.id}/forward-backward`,
        { microbatches: 4 }
      );
      await forge.mutate(
        "training",
        `/api/v1/training-runs/${activeRun.id}/optim-step`,
        {}
      );
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  async function saveVersion() {
    if (!activeRun) return;
    try {
      await forge.mutate("checkpoint", "/api/v1/checkpoints", {
        runId: activeRun.id
      });
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  return (
    <div className="page-flow">
      <PageIntro
        eyebrow="Training"
        title="Training workspace"
        copy="Configure, train, test, and save a model in one continuous workspace."
      />

      {activeRun && activeSession ? (
        <section className="operation-frame" aria-labelledby="active-run-title">
          <header className="operation-header">
            <div>
              <div className="object-label">
                <span>Selected run</span>
                <StatusTag status={activeRun.status} />
              </div>
              <h2 id="active-run-title">{activeSession.name}</h2>
              <p>
                {activeSession.model} <span aria-hidden="true">·</span>{" "}
                {recipes[activeSession.recipe].name}{" "}
                <span aria-hidden="true">·</span>{" "}
                {activeDataset?.name ?? "Legacy default dataset"}
              </p>
            </div>
            <code>{activeRun.id}</code>
          </header>

          <WorkflowTrack steps={workflow} currentStage={currentStage} />

          <div className="operation-grid">
            <div className="run-console">
              <div className="section-heading">
                <div>
                  <span>Training state</span>
                  <h3>Current progress</h3>
                </div>
                <span className="step-count">
                  Step {activeRun.step} of {activeRun.targetSteps}
                </span>
              </div>

              <Progress
                value={Math.min(
                  100,
                  Math.round((activeRun.step / activeRun.targetSteps) * 100)
                )}
              />

              <div className="metric-strip">
                <MetricCell
                  label="Status"
                  value={humanize(activeRun.status)}
                  icon={Activity}
                  tone={
                    activeRun.status === "completed"
                      ? "success"
                      : activeRun.status === "failed"
                        ? "danger"
                        : "info"
                  }
                />
                <MetricCell
                  label="Loss"
                  value={activeRun.loss}
                  icon={GitBranch}
                  tone="danger"
                />
                <MetricCell
                  label="Reward"
                  value={activeRun.reward}
                  icon={Zap}
                  tone="warning"
                />
                <MetricCell
                  label="Verifier"
                  value={activeRun.verifierScore}
                  icon={ShieldCheck}
                  tone="purple"
                />
              </div>

              <div className="run-actions">
                <button
                  className="button primary"
                  onClick={trainNextBatch}
                  disabled={
                    forge.busy !== null || activeRun.status === "completed"
                  }
                >
                  <Layers3 size={16} />
                  {forge.busy === "training"
                    ? "Training…"
                    : activeRun.status === "completed"
                      ? "Training complete"
                      : "Train next batch"}
                </button>
                <button
                  className="button secondary"
                  onClick={saveVersion}
                  disabled={forge.busy !== null}
                >
                  <Save size={16} />
                  {forge.busy === "checkpoint"
                    ? "Saving…"
                    : "Save model version"}
                </button>
              </div>

              <div className="primitive-note">
                <TerminalSquare size={16} />
                <p>
                  <strong>Train next batch</strong> runs{" "}
                  <code>forward_backward</code> and <code>optim_step</code>{" "}
                  together. The low-level primitives remain available through
                  the API.
                </p>
              </div>
            </div>

            <RunInspector
              key={activeSession.id}
              run={activeRun}
              session={activeSession}
            />
          </div>
        </section>
      ) : (
        <section className="empty-stage">
          <FlaskConical size={22} />
          <div>
            <h2>Start your first training run</h2>
            <p>
              Choose a base model and method below. Forge creates the underlying
              workspace automatically.
            </p>
          </div>
          <a className="button primary" href="#new-run">
            Configure run
          </a>
        </section>
      )}

      <NewRunForm />

      <section className="data-frame" aria-labelledby="run-history-title">
        <FrameHeader
          eyebrow="History"
          title="Runs"
          id="run-history-title"
          meta={`${forge.state.runs.length} total`}
        />
        <RunHistory
          runs={forge.state.runs}
          sessions={forge.state.sessions}
          activeRunId={forge.activeRun?.id}
          onSelect={forge.selectRun}
        />
      </section>
    </div>
  );
}

export function DatasetsPage() {
  const forge = useReadyForge();
  const [source, setSource] = useState<"huggingface" | "upload">("huggingface");
  const [hfForm, setHfForm] = useState({
    name: "",
    dataset: "",
    config: "",
    split: "",
    revision: ""
  });
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState("");

  async function linkHuggingFace(event: React.FormEvent) {
    event.preventDefault();
    setLocalError("");
    try {
      await forge.mutate("dataset-link", "/api/v1/datasets/huggingface", {
        name: hfForm.name.trim() || undefined,
        dataset: hfForm.dataset.trim(),
        config: hfForm.config.trim() || undefined,
        split: hfForm.split.trim() || undefined,
        revision: hfForm.revision.trim() || undefined
      });
      setHfForm({ name: "", dataset: "", config: "", split: "", revision: "" });
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    setLocalError("");
    if (!uploadFile) return;
    if (uploadFile.size > 6 * 1024 * 1024) {
      setLocalError("Uploads are limited to 6 MiB. Link larger datasets from Hugging Face.");
      return;
    }
    const form = new FormData();
    form.set("file", uploadFile);
    if (uploadName.trim()) form.set("name", uploadName.trim());
    try {
      await forge.uploadDataset(form);
      setUploadName("");
      setUploadFile(null);
      const input = document.getElementById("dataset-file") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  async function remove(dataset: Dataset) {
    if (
      !window.confirm(
        `Delete dataset ${dataset.name}? Uploaded source files are removed too.`
      )
    ) {
      return;
    }
    try {
      await forge.deleteDataset(dataset.id);
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  const readyDatasets = forge.state.datasets.filter(
    (dataset) => dataset.status === "ready"
  ).length;
  const totalRows = forge.state.datasets.reduce(
    (sum, dataset) => sum + (dataset.rowCount ?? 0),
    0
  );

  return (
    <div className="page-flow">
      <PageIntro
        eyebrow="Training data"
        title="Dataset registry"
        copy="Link a Hugging Face dataset or upload structured data. Forge inspects the schema, adds an adapter, and pins the selected source to every new run."
      />

      <div className="metric-strip dataset-metrics">
        <MetricCell
          label="Datasets"
          value={forge.state.datasets.length}
          icon={Database}
          tone="info"
        />
        <MetricCell
          label="Ready"
          value={readyDatasets}
          icon={CheckCircle2}
          tone="success"
        />
        <MetricCell
          label="Known rows"
          value={totalRows.toLocaleString()}
          icon={Layers3}
          tone="purple"
        />
        <MetricCell
          label="Canonical schema"
          value="forge-chat-v1"
          icon={SlidersHorizontal}
          tone="warning"
        />
      </div>

      <section className="dataset-connect-frame" aria-labelledby="connect-dataset-title">
        <header className="dataset-connect-header">
          <div>
            <span>Add source</span>
            <h2 id="connect-dataset-title">Connect a dataset</h2>
          </div>
          <div className="source-tabs" role="tablist" aria-label="Dataset source">
            <button
              type="button"
              role="tab"
              aria-selected={source === "huggingface"}
              className={source === "huggingface" ? "active" : undefined}
              onClick={() => setSource("huggingface")}
            >
              <Link2 size={15} />
              Hugging Face
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === "upload"}
              className={source === "upload" ? "active" : undefined}
              onClick={() => setSource("upload")}
            >
              <FileUp size={15} />
              Upload
            </button>
          </div>
        </header>

        {source === "huggingface" ? (
          <form className="dataset-source-form hf-source-form" onSubmit={linkHuggingFace}>
            <label>
              Dataset URL or ID
              <input
                required
                placeholder="HuggingFaceH4/no_robots"
                value={hfForm.dataset}
                onChange={(event) =>
                  setHfForm({ ...hfForm, dataset: event.target.value })
                }
              />
            </label>
            <label>
              Display name
              <input
                placeholder="Optional"
                value={hfForm.name}
                onChange={(event) =>
                  setHfForm({ ...hfForm, name: event.target.value })
                }
              />
            </label>
            <label>
              Configuration
              <input
                placeholder="Auto"
                value={hfForm.config}
                onChange={(event) =>
                  setHfForm({ ...hfForm, config: event.target.value })
                }
              />
            </label>
            <label>
              Split
              <input
                placeholder="train"
                value={hfForm.split}
                onChange={(event) =>
                  setHfForm({ ...hfForm, split: event.target.value })
                }
              />
            </label>
            <label>
              Revision
              <input
                placeholder="Optional tag or SHA"
                value={hfForm.revision}
                onChange={(event) =>
                  setHfForm({ ...hfForm, revision: event.target.value })
                }
              />
            </label>
            <button
              className="button primary"
              type="submit"
              disabled={forge.busy !== null || !hfForm.dataset.trim()}
            >
              <Link2 size={16} />
              {forge.busy === "dataset-link" ? "Inspecting…" : "Inspect and add"}
            </button>
          </form>
        ) : (
          <form className="dataset-source-form upload-source-form" onSubmit={upload}>
            <label>
              Dataset file
              <input
                id="dataset-file"
                required
                type="file"
                accept=".jsonl,.ndjson,.json,.csv,application/json,text/csv"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              Display name
              <input
                placeholder="Optional"
                value={uploadName}
                onChange={(event) => setUploadName(event.target.value)}
              />
            </label>
            <div className="upload-guidance">
              <strong>JSONL, JSON, or CSV · 6 MiB maximum</strong>
              <span>
                Chat messages, instruction/output, prompt/response, question/answer,
                and text columns are detected automatically.
              </span>
            </div>
            <button
              className="button primary"
              type="submit"
              disabled={forge.busy !== null || !uploadFile}
            >
              <FileUp size={16} />
              {forge.busy === "dataset-upload" ? "Uploading…" : "Upload and inspect"}
            </button>
          </form>
        )}
        {localError ? (
          <p className="dataset-local-error" role="alert">
            {localError}
          </p>
        ) : null}
      </section>

      <section className="data-frame" aria-labelledby="dataset-library-title">
        <FrameHeader
          eyebrow="Sources"
          title="Dataset library"
          id="dataset-library-title"
          meta={`${forge.state.datasets.length} total`}
        />
        {forge.state.datasets.length ? (
          <div className="dataset-list">
            {forge.state.datasets.map((dataset) => (
              <DatasetCard
                dataset={dataset}
                busy={forge.busy}
                onDelete={() => remove(dataset)}
                key={dataset.id}
              />
            ))}
          </div>
        ) : (
          <EmptyTable
            title="No datasets yet"
            copy="Link a public Hugging Face dataset or upload a small structured file to start training."
          />
        )}
      </section>
    </div>
  );
}

function DatasetCard({
  dataset,
  busy,
  onDelete
}: {
  dataset: Dataset;
  busy: string | null;
  onDelete: () => void;
}) {
  return (
    <article className="dataset-card">
      <header>
        <div>
          <div className="object-label">
            <span>{dataset.sourceType === "huggingface" ? "Hugging Face" : "Upload"}</span>
            <StatusTag status={dataset.status} />
          </div>
          <h3>{dataset.name}</h3>
          <code>{dataset.sourceUri.replace("hf://", "")}</code>
        </div>
        <button
          className="icon-button danger"
          type="button"
          disabled={busy !== null}
          title={`Delete ${dataset.name}`}
          aria-label={`Delete ${dataset.name}`}
          onClick={onDelete}
        >
          <Trash2 size={15} />
        </button>
      </header>

      <div className="dataset-summary">
        <span>
          <strong>{dataset.rowCount?.toLocaleString() ?? "Sampled"}</strong>
          rows
        </span>
        <span>
          <strong>{dataset.quality.validRows}/{dataset.quality.inspectedRows}</strong>
          valid preview
        </span>
        <span>
          <strong>{dataset.quality.duplicateRows}</strong>
          duplicates
        </span>
        <span>
          <strong>{dataset.quality.averageCharacters}</strong>
          avg. characters
        </span>
      </div>

      <div className="dataset-columns" aria-label="Detected columns">
        {dataset.columns.map((column) => (
          <code key={column}>{column}</code>
        ))}
      </div>

      {dataset.adapter ? (
        <div className="adapter-line">
          <SlidersHorizontal size={15} />
          <span>
            <strong>{humanize(dataset.adapter.format)}</strong>
            {adapterSummary(dataset.adapter)}
          </span>
        </div>
      ) : null}

      {dataset.canonicalPreview[0] ? (
        <details className="dataset-preview">
          <summary>Canonical preview</summary>
          <pre>{dataset.canonicalPreview[0]}</pre>
        </details>
      ) : null}

      {dataset.warnings.length || dataset.validationErrors.length ? (
        <div className="dataset-notices">
          {[...dataset.validationErrors, ...dataset.warnings].map((warning) => (
            <p key={warning}>
              <CircleAlert size={14} />
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      {dataset.status === "needs_mapping" ? (
        <DatasetAdapterForm dataset={dataset} />
      ) : null}
    </article>
  );
}

function DatasetAdapterForm({ dataset }: { dataset: Dataset }) {
  const forge = useReadyForge();
  const [format, setFormat] = useState<DatasetAdapter["format"]>("text");
  const [textField, setTextField] = useState(dataset.columns[0] ?? "");
  const [promptField, setPromptField] = useState(dataset.columns[0] ?? "");
  const [responseField, setResponseField] = useState(dataset.columns[1] ?? "");
  const [messagesField, setMessagesField] = useState(
    dataset.columns.includes("messages") ? "messages" : dataset.columns[0] ?? ""
  );
  const [roleField, setRoleField] = useState("role");
  const [contentField, setContentField] = useState("content");

  async function saveAdapter(event: React.FormEvent) {
    event.preventDefault();
    const adapter: DatasetAdapter = {
      format,
      roleMap: { human: "user", gpt: "assistant", bot: "assistant" },
      canonicalVersion: "forge-chat-v1"
    };
    if (format === "text") adapter.textField = textField;
    if (format === "prompt_response") {
      adapter.promptField = promptField;
      adapter.responseField = responseField;
    }
    if (format === "messages") {
      adapter.messagesField = messagesField;
      adapter.roleField = roleField;
      adapter.contentField = contentField;
    }
    try {
      await forge.mutate(
        "dataset-adapter",
        `/api/v1/datasets/${dataset.id}/adapter`,
        { adapter }
      );
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  return (
    <form className="adapter-form" onSubmit={saveAdapter}>
      <div className="adapter-form-title">
        <SlidersHorizontal size={15} />
        <span>
          <strong>Map this schema</strong>
          Choose how Forge should turn each source row into training data.
        </span>
      </div>
      <label>
        Record format
        <select
          value={format}
          onChange={(event) =>
            setFormat(event.target.value as DatasetAdapter["format"])
          }
        >
          <option value="text">Text</option>
          <option value="prompt_response">Prompt and response</option>
          <option value="messages">Message array</option>
        </select>
      </label>
      {format === "text" ? (
        <ColumnSelect
          label="Text column"
          columns={dataset.columns}
          value={textField}
          onChange={setTextField}
        />
      ) : null}
      {format === "prompt_response" ? (
        <>
          <ColumnSelect
            label="Prompt column"
            columns={dataset.columns}
            value={promptField}
            onChange={setPromptField}
          />
          <ColumnSelect
            label="Response column"
            columns={dataset.columns}
            value={responseField}
            onChange={setResponseField}
          />
        </>
      ) : null}
      {format === "messages" ? (
        <>
          <ColumnSelect
            label="Messages column"
            columns={dataset.columns}
            value={messagesField}
            onChange={setMessagesField}
          />
          <label>
            Role key
            <input value={roleField} onChange={(event) => setRoleField(event.target.value)} />
          </label>
          <label>
            Content key
            <input
              value={contentField}
              onChange={(event) => setContentField(event.target.value)}
            />
          </label>
        </>
      ) : null}
      <button
        className="button secondary"
        type="submit"
        disabled={forge.busy !== null}
      >
        {forge.busy === "dataset-adapter" ? "Validating…" : "Validate adapter"}
      </button>
    </form>
  );
}

function ColumnSelect({
  label,
  columns,
  value,
  onChange
}: {
  label: string;
  columns: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {columns.map((column) => (
          <option value={column} key={column}>
            {column}
          </option>
        ))}
      </select>
    </label>
  );
}

function adapterSummary(adapter: DatasetAdapter) {
  if (adapter.format === "text") return ` · ${adapter.textField}`;
  if (adapter.format === "prompt_response") {
    return ` · ${adapter.promptField} → ${adapter.responseField}`;
  }
  return ` · ${adapter.messagesField}`;
}

export function EvaluatePage() {
  const forge = useReadyForge();
  const latestScore = forge.state.verifierScores[0];
  const latestScoreTone = latestScore
    ? latestScore.score >= 0.7
      ? "success"
      : latestScore.score >= 0.4
        ? "warning"
        : "danger"
    : "";

  async function evaluateCandidate() {
    try {
      await forge.mutate("verify", "/api/verify", {
        candidate: forge.candidate,
        rubric: forge.rubric
      });
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  return (
    <div className="page-flow">
      <PageIntro
        eyebrow="Evaluation"
        title="Evaluate model output"
        copy={`Score an output from ${
          forge.activeSession?.name ?? "the selected run"
        } against explicit criteria before you save or deploy it.`}
      />

      <section className="evaluation-frame">
        <div className="evaluation-form">
          <div className="section-heading">
            <div>
              <span>Candidate</span>
              <h2>Score an output</h2>
            </div>
            {forge.sample ? (
              <button
                className="text-button"
                onClick={() => forge.setCandidate(forge.sample)}
              >
                Use latest test output
              </button>
            ) : null}
          </div>

          <label>
            Evaluation criteria
            <textarea
              value={forge.rubric}
              onChange={(event) => forge.setRubric(event.target.value)}
            />
          </label>
          <label>
            Model output
            <textarea
              className="candidate-input"
              value={forge.candidate}
              onChange={(event) => forge.setCandidate(event.target.value)}
            />
          </label>
          <div className="form-footer">
            <p>
              Scores combine task correctness, evidence, and confidence into a
              release signal.
            </p>
            <button
              className="button primary"
              onClick={evaluateCandidate}
              disabled={forge.busy !== null || !forge.candidate.trim()}
            >
              <ShieldCheck size={16} />
              {forge.busy === "verify" ? "Scoring…" : "Score output"}
            </button>
          </div>
        </div>

        <aside className="evaluation-results">
          <div className={`score-hero ${latestScoreTone}`}>
            <span>Latest score</span>
            <strong>{latestScore ? latestScore.score.toFixed(2) : "—"}</strong>
            <p>
              {latestScore
                ? latestScore.rationale
                : "Your first evaluation will appear here."}
            </p>
            {latestScore ? (
              <div className="confidence-line">
                <span>Confidence</span>
                <strong>{latestScore.confidence.toFixed(2)}</strong>
              </div>
            ) : null}
          </div>

          <div className="score-history">
            <div className="subsection-title">
              <h3>Recent evaluations</h3>
              <span>{forge.state.verifierScores.length}</span>
            </div>
            <ScoreHistory scores={forge.state.verifierScores} />
          </div>
        </aside>
      </section>
    </div>
  );
}

export function DeployPage() {
  const forge = useReadyForge();
  const [target, setTarget] = useState<Deployment["target"]>("baseten");

  async function deployVersion(checkpoint: Checkpoint) {
    try {
      await forge.mutate("deploy", "/api/v1/deployments", {
        checkpointId: checkpoint.id,
        target
      });
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  async function stopDeployment(deployment: Deployment) {
    try {
      await forge.mutate(
        "stop-deployment",
        `/api/v1/deployments/${deployment.id}/stop`,
        {}
      );
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  async function deleteDeployment(deployment: Deployment) {
    if (
      !window.confirm(
        `Delete endpoint ${deployment.providerDeploymentName ?? deployment.id}? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await forge.mutate(
        "delete-deployment",
        `/api/v1/deployments/${deployment.id}/delete`,
        {}
      );
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  async function deleteCheckpoint(checkpoint: Checkpoint) {
    const linkedEndpoints = forge.state.deployments.filter(
      (deployment) => deployment.checkpointId === checkpoint.id
    ).length;
    const consequence = linkedEndpoints
      ? ` This also deletes ${linkedEndpoints} linked endpoint${linkedEndpoints === 1 ? "" : "s"}.`
      : "";
    if (
      !window.confirm(
        `Delete saved model ${checkpoint.name}?${consequence} This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await forge.mutate(
        "delete-checkpoint",
        `/api/v1/checkpoints/${checkpoint.id}/delete`,
        {}
      );
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  const liveDeployments = forge.state.deployments.filter(
    (deployment) => deployment.status === "live"
  ).length;
  const bestScore = Math.max(
    0,
    ...forge.state.checkpoints.map((checkpoint) => checkpoint.score)
  );

  return (
    <div className="page-flow">
      <PageIntro
        eyebrow="Release"
        title="Deploy saved models"
        copy="Choose a verified model version, release it to a serving target, and operate the endpoint here."
      />

      <div className="metric-strip release-metrics">
        <MetricCell
          label="Saved versions"
          value={forge.state.checkpoints.length}
          icon={Archive}
          tone="info"
        />
        <MetricCell
          label="Live endpoints"
          value={liveDeployments}
          icon={Cloud}
          tone="success"
        />
        <MetricCell
          label="Best score"
          value={bestScore.toFixed(2)}
          icon={ShieldCheck}
          tone="purple"
        />
        <MetricCell
          label="Serving runtime"
          value={
            forge.state.providers.baseten === "configured"
              ? "Configured"
              : "Not configured"
          }
          icon={Server}
          tone={
            forge.state.providers.baseten === "configured"
              ? "success"
              : "warning"
          }
        />
      </div>

      <section className="data-frame" aria-labelledby="versions-title">
        <FrameHeader
          eyebrow="Promotion candidates"
          title="Saved model versions"
          id="versions-title"
          action={
            <label className="inline-select">
              <span>Release to</span>
              <select
                value={target}
                onChange={(event) =>
                  setTarget(event.target.value as Deployment["target"])
                }
              >
                <option value="baseten">Baseten</option>
                <option value="modal">Modal</option>
              </select>
            </label>
          }
        />
        <VersionTable
          checkpoints={forge.state.checkpoints}
          runs={forge.state.runs}
          sessions={forge.state.sessions}
          deployments={forge.state.deployments}
          busy={forge.busy}
          onDeploy={deployVersion}
          onDelete={deleteCheckpoint}
        />
      </section>

      <section className="data-frame" aria-labelledby="endpoints-title">
        <FrameHeader
          eyebrow="Operations"
          title="Endpoints"
          id="endpoints-title"
          meta={`${forge.state.deployments.length} total`}
        />
        <EndpointTable
          deployments={forge.state.deployments}
          busy={forge.busy}
          onStop={stopDeployment}
          onDelete={deleteDeployment}
        />
      </section>
    </div>
  );
}

function RunInspector({
  run,
  session
}: {
  run: TrainingRun;
  session: Session;
}) {
  const forge = useReadyForge();
  const [tab, setTab] = useState<"test" | "logs">("test");
  const [prompt, setPrompt] = useState(recipes[session.recipe].defaultPrompt);

  async function generateOutput() {
    try {
      const result = await forge.mutate<{ output: string }>(
        "sample",
        "/api/sample",
        {
          sessionId: session.id,
          prompt
        }
      );
      forge.setSample(result.output);
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  return (
    <aside className="run-inspector">
      <div
        className="local-tabs"
        role="tablist"
        aria-label="Run details"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const nextTab = tab === "test" ? "logs" : "test";
          setTab(nextTab);
          requestAnimationFrame(() => {
            document
              .getElementById(
                nextTab === "test" ? "run-test-tab" : "run-logs-tab"
              )
              ?.focus();
          });
        }}
      >
        <button
          id="run-test-tab"
          role="tab"
          aria-selected={tab === "test"}
          aria-controls="run-test-panel"
          tabIndex={tab === "test" ? 0 : -1}
          className={tab === "test" ? "active" : undefined}
          onClick={() => setTab("test")}
        >
          Test output
        </button>
        <button
          id="run-logs-tab"
          role="tab"
          aria-selected={tab === "logs"}
          aria-controls="run-logs-panel"
          tabIndex={tab === "logs" ? 0 : -1}
          className={tab === "logs" ? "active" : undefined}
          onClick={() => setTab("logs")}
        >
          Logs
        </button>
      </div>

      {tab === "test" ? (
        <div
          className="inspector-body"
          id="run-test-panel"
          role="tabpanel"
          aria-labelledby="run-test-tab"
        >
          <label>
            Prompt
            <textarea
              className="prompt-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <button
            className="button secondary full-width"
            disabled={forge.busy !== null || !prompt.trim()}
            onClick={generateOutput}
          >
            <Sparkles size={16} />
            {forge.busy === "sample" ? "Generating…" : "Generate test output"}
          </button>
          <div className="terminal-output" aria-live="polite">
            {forge.sample || "Generated output will appear here."}
          </div>
          {forge.sample ? (
            <Link className="inline-link" href="/evaluate">
              Evaluate this output
              <ArrowRight size={14} />
            </Link>
          ) : null}
        </div>
      ) : (
        <div
          className="log-viewer"
          id="run-logs-panel"
          role="tabpanel"
          aria-labelledby="run-logs-tab"
        >
          {run.logs.length ? (
            run.logs.map((line, index) => (
              <div key={`${line}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <code>{line}</code>
              </div>
            ))
          ) : (
            <p>No logs recorded for this run.</p>
          )}
        </div>
      )}
    </aside>
  );
}

function NewRunForm() {
  const forge = useReadyForge();
  const router = useRouter();
  const readyDatasets = forge.state.datasets.filter(
    (dataset) => dataset.status === "ready"
  );
  const selectedDatasetId =
    forge.runForm.datasetId || readyDatasets[0]?.id || "";

  async function startRun() {
    try {
      const result = await forge.mutate<{ run: TrainingRun }>(
        "new-run",
        "/api/sessions",
        { ...forge.runForm, datasetId: selectedDatasetId }
      );
      forge.selectRun(result.run.id);
      router.push("/runs");
      scrollWorkspaceTop();
    } catch {
      // ForgeProvider surfaces the request error in the shared alert.
    }
  }

  return (
    <section className="new-run-frame" id="new-run" aria-labelledby="new-run-title">
      <div className="new-run-copy">
        <span>New run</span>
        <h2 id="new-run-title">Configure training</h2>
        <p>
          Forge creates the backing session automatically. You only manage the
          run.
        </p>
      </div>

      <div className="new-run-fields">
        <label>
          Run name
          <input
            value={forge.runForm.name}
            onChange={(event) =>
              forge.setRunForm({ ...forge.runForm, name: event.target.value })
            }
          />
        </label>
        <label>
          Base model
          <select
            value={forge.runForm.model}
            onChange={(event) =>
              forge.setRunForm({ ...forge.runForm, model: event.target.value })
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
          Dataset
          <select
            value={selectedDatasetId}
            onChange={(event) =>
              forge.setRunForm({
                ...forge.runForm,
                datasetId: event.target.value
              })
            }
          >
            {!readyDatasets.length ? (
              <option value="">Add a dataset first</option>
            ) : null}
            {readyDatasets.map((dataset) => (
              <option value={dataset.id} key={dataset.id}>
                {dataset.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Training method
          <select
            value={forge.runForm.recipe}
            onChange={(event) =>
              forge.setRunForm({
                ...forge.runForm,
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
            value={forge.runForm.targetSteps}
            onChange={(event) =>
              forge.setRunForm({
                ...forge.runForm,
                targetSteps: Number(event.target.value)
              })
            }
          />
        </label>
        <button
          className="button primary start-run-button"
          onClick={startRun}
          disabled={
            forge.busy !== null ||
            !forge.runForm.name.trim() ||
            !selectedDatasetId ||
            forge.runForm.targetSteps < 1
          }
        >
          <Play size={16} fill="currentColor" />
          {forge.busy === "new-run" ? "Starting…" : "Start run"}
        </button>
      </div>
      {!readyDatasets.length ? (
        <Link className="new-run-dataset-callout" href="/datasets">
          <Database size={15} />
          Add or link a dataset before starting a run
          <ArrowRight size={14} />
        </Link>
      ) : null}
    </section>
  );
}

function WorkflowTrack({
  steps,
  currentStage
}: {
  steps: Array<{ label: string; complete: boolean }>;
  currentStage: number;
}) {
  return (
    <ol className="workflow-track" aria-label="Model lifecycle">
      {steps.map((step, index) => {
        const state = step.complete
          ? "complete"
          : index === currentStage
            ? "current"
            : "upcoming";
        return (
          <li className={state} key={step.label}>
            <span className="workflow-index">
              {step.complete ? <CheckCircle2 size={14} /> : index + 1}
            </span>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RunHistory({
  runs,
  sessions,
  activeRunId,
  onSelect
}: {
  runs: TrainingRun[];
  sessions: Session[];
  activeRunId?: string;
  onSelect: (runId: string) => void;
}) {
  if (!runs.length) {
    return (
      <EmptyTable
        title="No runs yet"
        copy="Start a run above to create your first training record."
      />
    );
  }

  return (
    <div className="table-shell run-history-table">
      <div className="table-header">
        <span>Run</span>
        <span>Status</span>
        <span>Progress</span>
        <span>Verifier</span>
        <span>Updated</span>
        <span aria-hidden="true" />
      </div>
      {runs.map((run) => {
        const session = sessions.find((item) => item.id === run.sessionId);
        const percent = Math.min(
          100,
          Math.round((run.step / run.targetSteps) * 100)
        );
        return (
          <button
            className={`table-row-button ${run.id === activeRunId ? "selected" : ""}`}
            key={run.id}
            onClick={() => {
              onSelect(run.id);
              scrollWorkspaceTop();
            }}
          >
            <span className="primary-cell" data-label="Run">
              <strong>{session?.name ?? run.name}</strong>
              <small>
                {session?.model ?? "Unknown model"} ·{" "}
                {session ? recipes[session.recipe].name : "Unknown method"}
              </small>
            </span>
            <span data-label="Status">
              <StatusTag status={run.status} />
            </span>
            <span className="progress-table-cell" data-label="Progress">
              <Progress value={percent} />
              <small>
                {run.step}/{run.targetSteps}
              </small>
            </span>
            <span className="numeric-cell" data-label="Verifier">
              {run.verifierScore.toFixed(2)}
            </span>
            <span className="muted-cell" data-label="Updated">
              {formatDate(run.updatedAt)}
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function VersionTable({
  checkpoints,
  runs,
  sessions,
  deployments,
  busy,
  onDeploy,
  onDelete
}: {
  checkpoints: Checkpoint[];
  runs: TrainingRun[];
  sessions: Session[];
  deployments: Deployment[];
  busy: string | null;
  onDeploy: (checkpoint: Checkpoint) => void;
  onDelete: (checkpoint: Checkpoint) => void;
}) {
  if (!checkpoints.length) {
    return (
      <EmptyTable
        title="No saved versions"
        copy="Save a model version from a training run to make it available here."
        link={{ href: "/runs", label: "Go to training" }}
      />
    );
  }

  return (
    <div className="table-shell version-table">
      <div className="table-header">
        <span>Version</span>
        <span>Source run</span>
        <span>Step</span>
        <span>Score</span>
        <span>Release</span>
        <span aria-hidden="true" />
      </div>
      {checkpoints.map((checkpoint) => {
        const run = runs.find((item) => item.id === checkpoint.runId);
        const session = run
          ? sessions.find((item) => item.id === run.sessionId)
          : undefined;
        const deployment = deployments.find(
          (item) => item.checkpointId === checkpoint.id
        );
        return (
          <div className="table-row" key={checkpoint.id}>
            <span className="primary-cell" data-label="Version">
              <strong>{checkpoint.name}</strong>
              <small>
                {checkpoint.adapterType.toUpperCase()} ·{" "}
                {session?.model ?? "model"}
              </small>
            </span>
            <span data-label="Source run">
              {session?.name ?? run?.name ?? checkpoint.runId}
            </span>
            <span className="numeric-cell" data-label="Step">
              {checkpoint.step}
            </span>
            <span className="numeric-cell" data-label="Score">
              {checkpoint.score.toFixed(2)}
            </span>
            <span data-label="Release">
              {deployment ? (
                <StatusTag status={deployment.status} />
              ) : (
                <button
                  className="button secondary small"
                  onClick={() => onDeploy(checkpoint)}
                  disabled={busy !== null}
                >
                  <Cloud size={14} />
                  {busy === "deploy" ? "Deploying…" : "Deploy"}
                </button>
              )}
            </span>
            <button
              className="icon-button danger"
              onClick={() => onDelete(checkpoint)}
              disabled={busy !== null}
              title={`Delete ${checkpoint.name}`}
              aria-label={`Delete ${checkpoint.name}`}
            >
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EndpointTable({
  deployments,
  busy,
  onStop,
  onDelete
}: {
  deployments: Deployment[];
  busy: string | null;
  onStop: (deployment: Deployment) => void;
  onDelete: (deployment: Deployment) => void;
}) {
  if (!deployments.length) {
    return (
      <EmptyTable
        title="No endpoints"
        copy="Deploy a saved model version above to create an endpoint."
      />
    );
  }

  return (
    <div className="table-shell endpoint-table">
      <div className="table-header">
        <span>Endpoint</span>
        <span>Status</span>
        <span>Provider</span>
        <span>URL</span>
        <span>Controls</span>
      </div>
      {deployments.map((deployment) => (
        <div className="table-row" key={deployment.id}>
          <span className="primary-cell" data-label="Endpoint">
            <strong>{deployment.providerDeploymentName ?? deployment.id}</strong>
            <small>{deployment.providerModelId ?? deployment.checkpointId}</small>
          </span>
          <span data-label="Status">
            <StatusTag status={deployment.status} />
          </span>
          <span data-label="Provider">
            {humanize(deployment.target)} · {deployment.mode}
          </span>
          <span className="endpoint-link-cell" data-label="URL">
            {deployment.endpointUrl ? (
              <a
                href={deployment.endpointUrl}
                target="_blank"
                rel="noreferrer"
                title={deployment.endpointUrl}
              >
                <span>{deployment.endpointUrl}</span>
                <ExternalLink size={13} />
              </a>
            ) : (
              <span className="muted-cell">Pending</span>
            )}
          </span>
          <span className="row-controls" data-label="Controls">
            {deployment.status !== "stopped" ? (
              <button
                className="icon-button"
                onClick={() => onStop(deployment)}
                disabled={busy !== null}
                title="Stop endpoint"
                aria-label={`Stop endpoint ${deployment.id}`}
              >
                <Power size={15} />
              </button>
            ) : null}
            <button
              className="icon-button danger"
              onClick={() => onDelete(deployment)}
              disabled={busy !== null}
              title="Delete endpoint"
              aria-label={`Delete endpoint ${deployment.id}`}
            >
              <Trash2 size={15} />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

function ScoreHistory({ scores }: { scores: VerifierScore[] }) {
  if (!scores.length) {
    return <p className="quiet-empty">No evaluations yet.</p>;
  }
  return (
    <div className="score-list">
      {scores.slice(0, 8).map((score) => (
        <div className="score-list-row" key={score.id}>
          <strong
            className={
              score.score >= 0.7
                ? "score-success"
                : score.score >= 0.4
                  ? "score-warning"
                  : "score-danger"
            }
          >
            {score.score.toFixed(2)}
          </strong>
          <div>
            <p>{score.candidate}</p>
            <span>{formatDate(score.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  copy,
  action
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-intro">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {action ? <div className="page-intro-action">{action}</div> : null}
    </header>
  );
}

function FrameHeader({
  eyebrow,
  title,
  id,
  meta,
  action
}: {
  eyebrow: string;
  title: string;
  id: string;
  meta?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="frame-header">
      <div>
        <span>{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
      {action ?? (meta ? <span className="frame-meta">{meta}</span> : null)}
    </header>
  );
}

function MetricCell({
  label,
  value,
  icon: Icon,
  tone
}: {
  label: string;
  value: string | number;
  icon: IconComponent;
  tone?: "success" | "danger" | "warning" | "info" | "purple";
}) {
  return (
    <div className={`metric-cell ${tone ? `metric-${tone}` : ""}`}>
      <div>
        <span>{label}</span>
        <Icon size={15} />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone =
    normalized === "completed" ||
    normalized === "ready" ||
    normalized === "live"
      ? "success"
      : normalized === "failed"
        ? "danger"
        : normalized === "queued" ||
            normalized === "draft" ||
            normalized === "stopping"
          ? "warning"
          : normalized === "running" || normalized === "deploying"
            ? "progressing"
            : "neutral";
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "danger"
        ? CircleAlert
        : tone === "progressing"
          ? Activity
          : Clock3;

  return (
    <span className={`status-tag ${tone}`}>
      <Icon size={12} />
      {humanize(status)}
    </span>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div
      className={`progress-track ${value >= 100 ? "complete" : ""}`}
      role="progressbar"
      aria-label="Run progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value}% complete`}
    >
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

function RuntimeRow({
  name,
  configured
}: {
  name: string;
  configured: boolean;
}) {
  return (
    <Link
      href="/account"
      className="runtime-row"
      aria-label={`${name}: ${configured ? "configured" : "not ready"}. Open account settings.`}
    >
      <span className={`runtime-dot ${configured ? "ready" : ""}`} />
      <span>{name}</span>
      <small>{configured ? "Configured" : "Not ready"}</small>
    </Link>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "F"
  );
}

function AccountAvatar({
  name,
  avatarUrl
}: {
  name: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    // Google avatar URLs are display-only metadata, never authorization data.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="account-avatar"
        src={avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span className="account-avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function EmptyTable({
  title,
  copy,
  link
}: {
  title: string;
  copy: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="empty-table">
      <div>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
      {link ? (
        <Link className="button secondary small" href={link.href}>
          {link.label}
          <ArrowRight size={14} />
        </Link>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-mark" aria-hidden="true">
        <AnvilLogo />
      </div>
      <div>
        <strong>Loading Forge</strong>
        <span>Connecting to the control plane…</span>
      </div>
    </div>
  );
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

async function fetchWithRenderRetry(path: string, init: RequestInit) {
  let lastResponse: Response | null = null;
  let lastText = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(path, init);
    if (response.ok) return Object.assign(response, { errorText: "" });
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

function humanize(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function scrollWorkspaceTop() {
  document
    .querySelector<HTMLElement>(".product-scroll")
    ?.scrollTo({ top: 0, behavior: "smooth" });
}
