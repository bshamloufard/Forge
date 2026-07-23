import { NextResponse } from "next/server";
import { getProviderHealth } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "forge-tinkering-mvp",
    timestamp: new Date().toISOString(),
    providers: getProviderHealth()
  });
}
