import { NextResponse } from "next/server";
import { createSession, readState } from "@/lib/store";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2).optional(),
  baseModel: z.string().min(2).optional(),
  model: z.string().min(2).optional(),
  recipe: z.enum(["chat-sft", "math-rl", "tool-rl", "harbor-agent-rl"]).default("chat-sft"),
  targetSteps: z.number().int().min(1).max(5000).optional()
});

export async function GET() {
  const state = await readState();
  return NextResponse.json({ sessions: state.sessions });
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const result = await createSession({
    name: body.name || `${body.recipe} session`,
    model: body.model || body.baseModel || "qwen3-8b",
    recipe: body.recipe,
    targetSteps: body.targetSteps
  });
  return NextResponse.json(result);
}
