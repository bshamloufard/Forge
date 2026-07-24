import { NextResponse } from "next/server";
import {
  getAppOrigin,
  sanitizeNextPath
} from "@/lib/auth";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import {
  readRequestText,
  RequestBodyTooLargeError
} from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let origin: string;
  try {
    origin = getAppOrigin(request);
  } catch {
    return configurationResponse();
  }

  if (!hasSupabasePublicConfig()) {
    return NextResponse.redirect(
      new URL("/auth/error?reason=config", origin),
      303
    );
  }

  let next = "/runs";
  try {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0];
    if (contentType && contentType !== "application/x-www-form-urlencoded") {
      return authRequestError("Unsupported form encoding.", 415);
    }
    const body = await readRequestText(request, 8_192);
    next = sanitizeNextPath(new URLSearchParams(body).get("next"));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return authRequestError("Sign-in request is too large.", 413);
    }
    return authRequestError("Malformed sign-in request.", 400);
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`
      }
    });

    if (error || !data.url) {
      return NextResponse.redirect(
        new URL("/auth/error?reason=oauth_start", origin),
        303
      );
    }

    const response = NextResponse.redirect(data.url, 303);
    response.headers.set(
      "Cache-Control",
      "private, no-cache, no-store, must-revalidate, max-age=0"
    );
    return response;
  } catch {
    return NextResponse.redirect(
      new URL("/auth/error?reason=oauth_start", origin),
      303
    );
  }
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

function authRequestError(error: string, status: number) {
  return Response.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
