import { NextResponse } from "next/server";
import { z } from "zod";
import { deployCheckpoint, readState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  checkpointId: z.string().min(1),
  target: z.enum(["baseten", "modal"]).default("baseten")
});

export async function GET() {
  const state = await readState();
  return NextResponse.json({ deployments: state.deployments });
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const result = await deployCheckpoint(body.checkpointId, body.target);
  return NextResponse.json(result);
}
