import { proxyToPython } from "@/lib/python-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DATASET_UPLOAD_BODY_BYTES = 7 * 1024 * 1024;

export async function POST(request: Request) {
  return proxyToPython(request, "/v1/datasets/upload", {
    maxBodyBytes: MAX_DATASET_UPLOAD_BODY_BYTES
  });
}
