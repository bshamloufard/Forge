import { proxyToPython } from "@/lib/python-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ deploymentId: string }> }
) {
  const { deploymentId } = await context.params;
  return proxyToPython(request, `/v1/deployments/${deploymentId}/invoke`);
}

