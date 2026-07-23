import { proxyToPython } from "@/lib/python-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return proxyToPython(request, "/v1/verifier/score_trajectory");
}

