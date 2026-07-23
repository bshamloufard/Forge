import { proxyToPython } from "@/lib/python-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyToPython(request, "/v1/checkpoints");
}

export async function POST(request: Request) {
  return proxyToPython(request, "/v1/checkpoints");
}

