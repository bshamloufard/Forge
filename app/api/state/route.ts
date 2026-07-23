import { proxyToPython } from "@/lib/python-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyToPython(request, "/api/state");
}

export async function DELETE(request: Request) {
  return proxyToPython(request, "/api/state");
}

