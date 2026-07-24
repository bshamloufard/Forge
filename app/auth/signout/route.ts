import { NextResponse } from "next/server";
import { getAppOrigin } from "@/lib/auth";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let destination: URL;
  try {
    destination = new URL("/", getAppOrigin(request));
  } catch {
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

  if (hasSupabasePublicConfig()) {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  }

  const response = NextResponse.redirect(destination, 303);
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0"
  );
  return response;
}

export function GET() {
  return Response.json(
    { error: "Sign out requires POST." },
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store"
      }
    }
  );
}
