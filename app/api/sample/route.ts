import { NextResponse } from "next/server";
import { z } from "zod";
import { sampleFromSession } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1)
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const result = await sampleFromSession(body.sessionId, body.prompt);
  return NextResponse.json(result);
}
