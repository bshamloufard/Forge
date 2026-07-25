export type ProviderMode = "mock" | "configured";

export type RunStatus = "queued" | "running" | "completed" | "failed";

export type RecipeId = "chat-sft" | "math-rl" | "tool-rl" | "harbor-agent-rl";

export type Project = {
  id: string;
  name: string;
  organization: string;
  createdAt: string;
};

export type Session = {
  id: string;
  projectId: string;
  name: string;
  creator: string;
  model: string;
  recipe: RecipeId;
  datasetId?: string | null;
  provider: "modal";
  createdAt: string;
  updatedAt: string;
};

export type TrainingRun = {
  id: string;
  sessionId: string;
  name: string;
  datasetId?: string | null;
  status: RunStatus;
  step: number;
  targetSteps: number;
  loss: number;
  reward: number;
  verifierScore: number;
  tokens: number;
  costUsd: number;
  logs: string[];
  createdAt: string;
  updatedAt: string;
};

export type Checkpoint = {
  id: string;
  sessionId: string;
  runId: string;
  name: string;
  step: number;
  adapterType: "lora";
  artifactUri: string;
  score: number;
  createdAt: string;
};

export type Deployment = {
  id: string;
  checkpointId: string;
  target: "baseten" | "modal";
  status: "draft" | "deploying" | "live" | "failed" | "stopped";
  endpointUrl: string;
  mode: ProviderMode;
  artifactUri?: string | null;
  providerModelId?: string | null;
  providerDeploymentId?: string | null;
  providerDeploymentName?: string | null;
  logsUrl?: string | null;
  createdAt: string;
};

export type VerifierScore = {
  id: string;
  candidate: string;
  rubric: string;
  score: number;
  confidence: number;
  rationale: string;
  createdAt: string;
};

export type DatasetAdapter = {
  format: "text" | "prompt_response" | "messages";
  textField?: string | null;
  promptField?: string | null;
  responseField?: string | null;
  inputField?: string | null;
  messagesField?: string | null;
  roleField?: string | null;
  contentField?: string | null;
  roleMap: Record<string, string>;
  canonicalVersion: "forge-chat-v1";
};

export type DatasetQuality = {
  inspectedRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  averageCharacters: number;
};

export type Dataset = {
  id: string;
  projectId: string;
  name: string;
  sourceType: "huggingface" | "upload";
  sourceUri: string;
  sourceConfig?: string | null;
  sourceSplit: string;
  sourceRevision?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  byteSize?: number | null;
  storageUri?: string | null;
  status: "ready" | "needs_mapping" | "failed";
  adapter?: DatasetAdapter | null;
  columns: string[];
  rowCount?: number | null;
  preview: Array<Record<string, unknown>>;
  canonicalPreview: string[];
  quality: DatasetQuality;
  warnings: string[];
  validationErrors: string[];
  createdAt: string;
  updatedAt: string;
};

export type ForgeState = {
  project: Project;
  datasets: Dataset[];
  sessions: Session[];
  runs: TrainingRun[];
  checkpoints: Checkpoint[];
  deployments: Deployment[];
  verifierScores: VerifierScore[];
};

export type ProviderHealth = {
  modal: ProviderMode;
  baseten: ProviderMode;
  supabase: ProviderMode;
};
