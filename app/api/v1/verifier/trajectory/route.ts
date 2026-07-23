import { NextResponse } from "next/server";
import { z } from "zod";
import { scoreTrajectory } from "@/lib/verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  events: z.array(z.union([z.string(), z.object({ role: z.string().optional(), content: z.string() })])).min(1),
  rubric: z.string().optional()
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const events = body.events.map((event) => (typeof event === "string" ? event : `${event.role || "event"}: ${event.content}`));
  return NextResponse.json(scoreTrajectory(events, body.rubric));
}
