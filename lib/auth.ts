import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createBearerClient, createClient } from "@/lib/supabase/server";

export type AuthenticatedRequest = {
  supabase: SupabaseClient;
  user: User;
  accessToken: string | null;
};

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error ? null : user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

export async function authenticateRequest(
  request: Request
): Promise<AuthenticatedRequest | null> {
  const authorization = request.headers.get("authorization");
  const bearerMatch = authorization?.match(/^Bearer ([^\s]+)$/i);

  if (authorization && !bearerMatch) return null;

  const accessToken = bearerMatch?.[1] ?? null;
  const supabase = accessToken
    ? createBearerClient(accessToken)
    : await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser(accessToken ?? undefined);

  if (error || !user) return null;
  return { supabase, user, accessToken };
}

export function sanitizeNextPath(
  candidate: string | null | undefined,
  fallback = "/runs"
) {
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://forge.invalid");
    if (parsed.origin !== "https://forge.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function getAppOrigin(request: Request) {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname))
      ) {
        return url.origin;
      }
    } catch {
      // Fall back to the request URL after validating it below.
    }
  }

  const requestUrl = new URL(request.url);
  if (
    requestUrl.protocol === "https:" ||
    (requestUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(requestUrl.hostname))
  ) {
    return requestUrl.origin;
  }

  throw new Error("Unable to determine a trusted application origin");
}
