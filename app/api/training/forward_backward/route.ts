import { NextResponse } from "next/server";
import { z } from "zod";
import { forwardBackward } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  runId: z.string().min(1),
  microbatches: z.number().int().min(1).max(64).default(4)
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const result = await forwardBackward(body.runId, body.microbatches);
  return NextResponse.json(result);
}
