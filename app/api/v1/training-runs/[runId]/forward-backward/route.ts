import { NextResponse } from "next/server";
import { z } from "zod";
import { forwardBackward } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  microbatches: z.number().int().min(1).max(64).default(4)
});

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const params = await context.params;
  const body = schema.parse(await request.json().catch(() => ({})));
  const result = await forwardBackward(params.runId, body.microbatches);
  return NextResponse.json(result);
}
