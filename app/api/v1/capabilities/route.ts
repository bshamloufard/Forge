import { NextResponse } from "next/server";
import { getProviderHealth } from "@/lib/providers";
import { models, recipes } from "@/lib/recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    models,
    recipes,
    losses: ["cross_entropy", "importance_sampling", "ppo", "custom_logprob"],
    providers: getProviderHealth(),
    deploymentTargets: ["baseten", "modal"],
    verifierBackends: ["heuristic", "openai_logprobs", "gemini_logprobs", "vllm_logprobs"],
    primitives: ["forward_backward", "optim_step", "sample", "save_state", "verify", "rank", "score_trajectory"]
  });
}
