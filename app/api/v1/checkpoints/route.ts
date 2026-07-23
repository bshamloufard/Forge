import { NextResponse } from "next/server";
import { z } from "zod";
import { readState, saveCheckpoint } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  runId: z.string().min(1),
  name: z.string().min(1).optional(),
  kind: z.enum(["state", "sampler_weights", "export"]).optional()
});

export async function GET() {
  const state = await readState();
  return NextResponse.json({ checkpoints: state.checkpoints });
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const result = await saveCheckpoint(body.runId, body.name);
  return NextResponse.json(result);
}
