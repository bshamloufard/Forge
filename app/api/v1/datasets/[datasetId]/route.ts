import { proxyToPython } from "@/lib/python-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ datasetId: string }> }
) {
  const { datasetId } = await context.params;
  return proxyToPython(request, `/v1/datasets/${datasetId}`);
}
