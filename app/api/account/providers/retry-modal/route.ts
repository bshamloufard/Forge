import { getAccountSummary } from "@/lib/account";
import { authenticateRequest } from "@/lib/auth";
import { retryModalSetup } from "@/lib/provider-validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);

  const result = await retryModalSetup(auth.user);
  if (!result.ok) return jsonError(result.error, result.status);

  const account = await getAccountSummary(auth.supabase, auth.user);
  return Response.json(
    { account, modal: result.modal },
    { headers: noStoreHeaders() }
  );
}

function jsonError(error: string, status: number) {
  return Response.json(
    { error },
    {
      status,
      headers: noStoreHeaders()
    }
  );
}

function noStoreHeaders() {
  return {
    "Cache-Control":
      "private, no-cache, no-store, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0"
  };
}
