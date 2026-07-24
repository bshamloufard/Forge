"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseCookieOptions,
  getSupabasePublicConfig
} from "@/lib/supabase/config";

let browserClient: SupabaseClient | undefined;

export function createClient() {
  if (browserClient) return browserClient;

  const { url, publishableKey } = getSupabasePublicConfig();
  browserClient = createBrowserClient(url, publishableKey, {
    cookieOptions: getSupabaseCookieOptions()
  });
  return browserClient;
}
