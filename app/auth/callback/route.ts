import { NextResponse } from "next/server";
import {
  getAppOrigin,
  sanitizeNextPath
} from "@/lib/auth";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeNextPath(requestUrl.searchParams.get("next"));
  let origin: string;

  try {
    origin = getAppOrigin(request);
  } catch {
    return configurationResponse();
  }

  if (!hasSupabasePublicConfig()) {
    return redirectNoStore(
      new URL("/auth/error?reason=config", origin)
    );
  }

  try {
    if (!code) {
      return redirectNoStore(
        new URL("/auth/error?reason=missing_code", origin)
      );
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return redirectNoStore(
        new URL("/auth/error?reason=code_exchange", origin)
      );
    }

    return redirectNoStore(new URL(next, origin));
  } catch {
    return redirectNoStore(
      new URL("/auth/error?reason=code_exchange", origin)
    );
  }
}

function redirectNoStore(destination: URL) {
  const response = NextResponse.redirect(destination, 303);
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0"
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function configurationResponse() {
  return Response.json(
    { error: "A trusted application URL is not configured." },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
