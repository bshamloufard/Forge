import { authenticateRequest } from "@/lib/auth";
import { getAccountSummary } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return unauthorized();

  const account = await getAccountSummary(auth.supabase, auth.user);
  return Response.json(
    { account },
    {
      headers: noStoreHeaders()
    }
  );
}

function unauthorized() {
  return Response.json(
    { error: "Authentication required." },
    {
      status: 401,
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
