import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2),
  model: z.string().min(2),
  recipe: z.enum(["chat-sft", "math-rl", "tool-rl", "harbor-agent-rl"]),
  targetSteps: z.number().int().min(1).max(5000).optional()
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const result = await createSession(body);
  return NextResponse.json(result);
}
