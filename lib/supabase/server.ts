import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  getSupabaseCookieOptions,
  getSupabasePublicConfig
} from "@/lib/supabase/config";

export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabasePublicConfig();

  return createServerClient(url, publishableKey, {
    cookieOptions: getSupabaseCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The root proxy refreshes
          // sessions before rendering; Route Handlers and Server Actions can write.
        }
      }
    }
  });
}

export function createBearerClient(accessToken: string): SupabaseClient {
  const { url, publishableKey } = getSupabasePublicConfig();

  return createSupabaseClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}
