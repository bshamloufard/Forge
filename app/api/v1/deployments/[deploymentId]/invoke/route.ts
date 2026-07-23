import { NextResponse } from "next/server";
import { z } from "zod";
import { readState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
  prompt: z.string().optional()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ deploymentId: string }> }
) {
  const params = await context.params;
  const body = schema.parse(await request.json());
  const state = await readState();
  const deployment = state.deployments.find((item) => item.id === params.deploymentId);
  if (!deployment) {
    return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
  }
  const prompt =
    body.prompt ||
    body.messages?.map((message) => `${message.role}: ${message.content}`).join("\n") ||
    "Hello";
  return NextResponse.json({
    id: `chatcmpl-${deployment.id}`,
    object: "chat.completion",
    model: deployment.checkpointId,
    provider_mode: deployment.mode,
    endpoint: deployment.endpointUrl,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: `Mock deployed adapter response for: ${prompt}`
        },
        finish_reason: "stop"
      }
    ]
  });
}
