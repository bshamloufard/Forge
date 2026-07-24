import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import {
  getSupabaseCookieOptions,
  getSupabasePublicConfig
} from "@/lib/supabase/config";

export type SessionProxyResult = {
  response: NextResponse;
  authenticated: boolean;
};

export async function updateSession(
  request: NextRequest
): Promise<SessionProxyResult> {
  const { url, publishableKey } = getSupabasePublicConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: getSupabaseCookieOptions(request.url),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, responseHeaders) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(responseHeaders).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      }
    }
  });

  const { data, error } = await supabase.auth.getClaims();
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0"
  );

  return {
    response,
    authenticated: !error && Boolean(data?.claims?.sub)
  };
}

export function redirectWithSession(
  destination: URL,
  sessionResponse: NextResponse,
  status: 303 | 307 = 307
) {
  const response = NextResponse.redirect(destination, status);

  sessionResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  for (const headerName of ["cache-control", "expires", "pragma"]) {
    const value = sessionResponse.headers.get(headerName);
    if (value) response.headers.set(headerName, value);
  }

  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0"
  );
  return response;
}
