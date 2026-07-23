import { NextResponse } from "next/server";
import { optimStep } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const params = await context.params;
  const result = await optimStep(params.runId);
  return NextResponse.json(result);
}
