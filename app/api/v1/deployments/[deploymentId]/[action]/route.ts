import { proxyToPython } from "@/lib/python-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actions = new Set(["start", "stop", "delete"]);

export async function POST(
  request: Request,
  context: {
    params: Promise<{ deploymentId: string; action: string }>;
  }
) {
  const { deploymentId, action } = await context.params;
  if (!actions.has(action)) {
    return Response.json({ error: "Unknown deployment action." }, { status: 404 });
  }
  return proxyToPython(
    request,
    `/v1/deployments/${encodeURIComponent(deploymentId)}/${action}`
  );
}
