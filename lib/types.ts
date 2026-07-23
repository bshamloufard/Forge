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
  provider: "modal";
  createdAt: string;
  updatedAt: string;
};

export type TrainingRun = {
  id: string;
  sessionId: string;
  name: string;
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
  status: "draft" | "deploying" | "live" | "failed";
  endpointUrl: string;
  mode: ProviderMode;
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

export type ForgeState = {
  project: Project;
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
