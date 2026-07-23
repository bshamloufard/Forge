import { NextResponse } from "next/server";
import { z } from "zod";
import { saveCheckpoint } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  runId: z.string().min(1),
  name: z.string().min(1).optional()
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const result = await saveCheckpoint(body.runId, body.name);
  return NextResponse.json(result);
}
