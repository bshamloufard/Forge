import { NextResponse } from "next/server";
import { z } from "zod";
import { readState, sampleFromSession } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  sessionId: z.string().min(1).optional(),
  samplingClientId: z.string().min(1).optional(),
  prompt: z.string().optional(),
  input: z
    .object({
      type: z.string().optional(),
      messages: z.array(z.object({ role: z.string(), content: z.string() })).optional()
    })
    .optional()
});

export async function GET() {
  return NextResponse.json({ samplingJobs: [] });
}

export async function POST(request: Request) {
  const state = await readState();
  const body = schema.parse(await request.json());
  const sessionId = body.sessionId || body.samplingClientId || state.sessions[0]?.id;
  const prompt =
    body.prompt ||
    body.input?.messages?.map((message) => `${message.role}: ${message.content}`).join("\n") ||
    "Sample from the current adapter.";
  if (!sessionId) {
    return NextResponse.json({ error: "No session available" }, { status: 400 });
  }
  const result = await sampleFromSession(sessionId, prompt);
  return NextResponse.json({ status: "succeeded", ...result });
}
