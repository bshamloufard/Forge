import { promises as fs } from "fs";
import path from "path";
import { createId } from "@/lib/ids";
import { recipes } from "@/lib/recipes";
import { createServingEndpoint } from "@/lib/providers";
import { scoreCandidate } from "@/lib/verifier";
import type {
  Checkpoint,
  Deployment,
  ForgeState,
  RecipeId,
  Session,
  TrainingRun,
  VerifierScore
} from "@/lib/types";

const dataDir = path.join(process.cwd(), ".forge");
const stateFile = path.join(dataDir, "state.json");

const now = () => new Date().toISOString();

function initialState(): ForgeState {
  const createdAt = now();
  const sessionId = createId("ses");
  const runId = createId("run");
  const checkpointId = createId("ckpt");

  return {
    project: {
      id: "proj_default",
      name: "Forge Research",
      organization: "Default Org",
      createdAt
    },
    sessions: [
      {
        id: sessionId,
        projectId: "proj_default",
        name: "qwen3 chat-sft baseline",
        creator: "researcher@forge.local",
        model: "qwen3-8b",
        recipe: "chat-sft",
        provider: "modal",
        createdAt,
        updatedAt: createdAt
      }
    ],
    runs: [
      {
        id: runId,
        sessionId,
        name: "baseline-lora",
        status: "running",
        step: 42,
        targetSteps: 120,
        loss: 1.62,
        reward: 0.48,
        verifierScore: 0.57,
        tokens: 184000,
        costUsd: 7.84,
        logs: [
          "session opened on modal adapter",
          "sampled 16 prompts from chat-sft seed set",
          "forward_backward accumulated 4 microbatches",
          "optim_step applied LoRA rank=16 update"
        ],
        createdAt,
        updatedAt: createdAt
      }
    ],
    checkpoints: [
      {
        id: checkpointId,
        sessionId,
        runId,
        name: "baseline-step-040",
        step: 40,
        adapterType: "lora",
        artifactUri: "supabase://mock-artifacts/checkpoints/baseline-step-040.safetensors",
        score: 0.55,
        createdAt
      }
    ],
    deployments: [],
    verifierScores: [
      {
        id: createId("ver"),
        candidate:
          "The model uses explicit checkpoints so each experiment can be resumed, exported, evaluated, and deployed without losing lineage.",
        rubric: "Clear explanation with checkpoint, resume, export, evaluation, and deployment coverage.",
        score: 0.82,
        confidence: 0.76,
        rationale: "Seed verifier example for the dashboard.",
        createdAt
      }
    ]
  };
}

export async function readState(): Promise<ForgeState> {
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    return JSON.parse(raw) as ForgeState;
  } catch {
    const state = initialState();
    await writeState(state);
    return state;
  }
}

export async function writeState(state: ForgeState) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
}

export async function resetState() {
  const state = initialState();
  await writeState(state);
  return state;
}

export async function createSession(input: {
  name: string;
  model: string;
  recipe: RecipeId;
  targetSteps?: number;
}) {
  const state = await readState();
  const timestamp = now();
  const session: Session = {
    id: createId("ses"),
    projectId: state.project.id,
    name: input.name,
    creator: "researcher@forge.local",
    model: input.model,
    recipe: input.recipe,
    provider: "modal",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const run: TrainingRun = {
    id: createId("run"),
    sessionId: session.id,
    name: `${recipes[input.recipe].name.toLowerCase().replace(/\s+/g, "-")}-run`,
    status: "queued",
    step: 0,
    targetSteps: input.targetSteps ?? 100,
    loss: 2.4,
    reward: 0.22,
    verifierScore: 0.31,
    tokens: 0,
    costUsd: 0,
    logs: [
      `created ${recipes[input.recipe].name} session for ${input.model}`,
      "waiting for first forward_backward call"
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  };

  state.sessions.unshift(session);
  state.runs.unshift(run);
  await writeState(state);
  return { state, session, run };
}

export async function forwardBackward(runId: string, microbatches = 4) {
  const state = await readState();
  const run = state.runs.find((item) => item.id === runId);
  if (!run) throw new Error("Run not found");
  run.status = "running";
  run.step = Math.min(run.targetSteps, run.step + Math.max(1, microbatches));
  run.tokens += microbatches * 2048;
  run.loss = Number(Math.max(0.32, run.loss * (0.985 - Math.min(0.004, microbatches / 400))).toFixed(3));
  run.reward = Number(Math.min(0.96, run.reward + 0.012 * microbatches).toFixed(3));
  run.verifierScore = Number(Math.min(0.98, run.verifierScore + 0.01 * microbatches).toFixed(3));
  run.costUsd = Number((run.costUsd + microbatches * 0.18).toFixed(2));
  run.updatedAt = now();
  run.logs.unshift(`forward_backward accumulated ${microbatches} microbatches at step ${run.step}`);
  if (run.step >= run.targetSteps) run.status = "completed";
  await writeState(state);
  return { state, run };
}

export async function optimStep(runId: string) {
  const state = await readState();
  const run = state.runs.find((item) => item.id === runId);
  if (!run) throw new Error("Run not found");
  run.status = run.step >= run.targetSteps ? "completed" : "running";
  run.loss = Number(Math.max(0.28, run.loss - 0.035).toFixed(3));
  run.reward = Number(Math.min(0.99, run.reward + 0.025).toFixed(3));
  run.verifierScore = Number(Math.min(0.99, run.verifierScore + 0.018).toFixed(3));
  run.costUsd = Number((run.costUsd + 0.42).toFixed(2));
  run.updatedAt = now();
  run.logs.unshift("optim_step applied LoRA adapter update and refreshed sampler weights");
  await writeState(state);
  return { state, run };
}

export async function saveCheckpoint(runId: string, name?: string) {
  const state = await readState();
  const run = state.runs.find((item) => item.id === runId);
  if (!run) throw new Error("Run not found");
  const checkpoint: Checkpoint = {
    id: createId("ckpt"),
    sessionId: run.sessionId,
    runId: run.id,
    name: name || `${run.name}-step-${String(run.step).padStart(3, "0")}`,
    step: run.step,
    adapterType: "lora",
    artifactUri: `supabase://mock-artifacts/checkpoints/${run.id}/step-${run.step}.safetensors`,
    score: run.verifierScore,
    createdAt: now()
  };
  state.checkpoints.unshift(checkpoint);
  run.logs.unshift(`save_state wrote ${checkpoint.name}`);
  run.updatedAt = now();
  await writeState(state);
  return { state, checkpoint };
}

export async function sampleFromSession(sessionId: string, prompt: string) {
  const state = await readState();
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error("Session not found");
  const recipe = recipes[session.recipe];
  const output = [
    `Model ${session.model} sampled under ${recipe.name}.`,
    `Prompt: ${prompt}`,
    `Answer: ${recipe.objective} The current adapter would respond with a concise plan, cite artifacts, and ask the verifier for a confidence score before promotion.`
  ].join("\n");
  return { output, session };
}

export async function verifyCandidate(input: {
  candidate: string;
  rubric?: string;
  reference?: string;
  criteria?: Array<{ name: string; weight: number }>;
}) {
  const state = await readState();
  const result = scoreCandidate(input);
  const verifierScore: VerifierScore = {
    id: createId("ver"),
    candidate: input.candidate,
    rubric: input.rubric || "General task correctness and evidence quality.",
    score: result.score,
    confidence: result.confidence,
    rationale: result.rationale,
    createdAt: now()
  };
  state.verifierScores.unshift(verifierScore);
  await writeState(state);
  return { state, verifierScore, ...result };
}

export async function deployCheckpoint(checkpointId: string, target: "baseten" | "modal") {
  const state = await readState();
  const checkpoint = state.checkpoints.find((item) => item.id === checkpointId);
  if (!checkpoint) throw new Error("Checkpoint not found");
  const endpoint = await createServingEndpoint(checkpoint.name, target);
  const deployment: Deployment = {
    id: createId("dep"),
    checkpointId,
    target,
    status: "live",
    endpointUrl: endpoint.endpointUrl,
    mode: endpoint.mode,
    createdAt: now()
  };
  state.deployments.unshift(deployment);
  await writeState(state);
  return { state, deployment };
}
