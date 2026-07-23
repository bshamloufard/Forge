import { NextResponse } from "next/server";
import { getProviderHealth } from "@/lib/providers";
import { readState, resetState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readState();
  return NextResponse.json({ ...state, providers: getProviderHealth() });
}

export async function DELETE() {
  const state = await resetState();
  return NextResponse.json({ ...state, providers: getProviderHealth() });
}
