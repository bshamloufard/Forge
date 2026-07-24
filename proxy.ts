import { type NextRequest, NextResponse } from "next/server";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import {
  redirectWithSession,
  updateSession
} from "@/lib/supabase/proxy";

const protectedPrefixes = [
  "/runs",
  "/evaluate",
  "/deployments",
  "/checkpoints",
  "/sessions",
  "/verifier",
  "/account"
];

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const protectedRoute = protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!hasSupabasePublicConfig()) {
    if (!protectedRoute) return NextResponse.next();
    return NextResponse.redirect(new URL("/auth/error?reason=config", request.url));
  }

  const session = await updateSession(request);

  if (protectedRoute && !session.authenticated) {
    const destination = new URL("/", request.url);
    destination.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`
    );
    return redirectWithSession(destination, session.response);
  }

  if (pathname === "/" && session.authenticated) {
    return redirectWithSession(
      new URL("/runs", request.url),
      session.response
    );
  }

  return session.response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
