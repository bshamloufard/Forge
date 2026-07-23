import { NextResponse } from "next/server";
import { z } from "zod";
import { rankCandidates } from "@/lib/verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  candidates: z.array(z.string().min(1)).min(1),
  rubric: z.string().optional(),
  reference: z.string().optional(),
  criteria: z.array(z.object({ name: z.string(), weight: z.number() })).optional()
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  return NextResponse.json(rankCandidates(body));
}
