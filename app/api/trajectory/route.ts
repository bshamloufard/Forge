import { NextResponse } from "next/server";
import { z } from "zod";
import { scoreTrajectory } from "@/lib/verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  events: z.array(z.string().min(1)).min(1),
  rubric: z.string().optional()
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  return NextResponse.json(scoreTrajectory(body.events, body.rubric));
}
