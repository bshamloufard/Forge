import { NextResponse } from "next/server";
import { z } from "zod";
import { optimStep } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  runId: z.string().min(1)
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const result = await optimStep(body.runId);
  return NextResponse.json(result);
}
