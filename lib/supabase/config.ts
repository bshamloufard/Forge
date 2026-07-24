export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export function getSupabaseCookieOptions(origin?: string) {
  let secure = process.env.APP_ENV === "production";
  const candidate =
    origin ||
    process.env.APP_BASE_URL ||
    (typeof window !== "undefined" ? window.location.href : "");

  if (candidate) {
    try {
      secure = new URL(candidate).protocol === "https:";
    } catch {
      // Keep the environment-derived default for a malformed optional origin.
    }
  }

  return {
    path: "/",
    sameSite: "lax" as const,
    secure
  };
}

export class SupabaseConfigurationError extends Error {
  constructor() {
    super(
      "Supabase authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
    this.name = "SupabaseConfigurationError";
  }
}

export function hasSupabasePublicConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      (
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      )?.trim()
  );
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!url || !publishableKey) {
    throw new SupabaseConfigurationError();
  }

  return { url, publishableKey };
}
