import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

export type ProviderReadiness = {
  modal: boolean;
  baseten: boolean;
  storage: boolean;
  updatedAt: string | null;
};

export type SafeAccountSummary = {
  available: boolean;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
  };
  onboardingSeen: boolean;
  onboardingSeenAt: string | null;
  providers: ProviderReadiness;
};

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  onboarding_seen_at: string | null;
};

type ProviderStatusRow = {
  modal_configured: boolean;
  baseten_configured: boolean;
  storage_configured: boolean;
  configuration_updated_at: string | null;
};

export async function getAccountSummary(
  supabase: SupabaseClient,
  user: User
): Promise<SafeAccountSummary> {
  const [profileResult, statusResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,full_name,avatar_url,onboarding_seen_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.rpc("get_provider_setup_status")
  ]);

  if (profileResult.error || statusResult.error) {
    return fallbackAccount(user);
  }

  const profile = profileResult.data as ProfileRow | null;
  const statusRows = Array.isArray(statusResult.data)
    ? statusResult.data
    : statusResult.data
      ? [statusResult.data]
      : [];
  const status = statusRows[0] as ProviderStatusRow | undefined;

  return {
    available: Boolean(profile),
    user: {
      id: user.id,
      email: profile?.email || user.email || "",
      displayName:
        profile?.full_name ||
        metadataString(user, "full_name") ||
        metadataString(user, "name") ||
        user.email?.split("@")[0] ||
        "Forge user",
      avatarUrl: safeAvatarUrl(
        profile?.avatar_url || metadataString(user, "avatar_url")
      )
    },
    onboardingSeen: Boolean(profile?.onboarding_seen_at),
    onboardingSeenAt: profile?.onboarding_seen_at ?? null,
    providers: {
      modal: Boolean(status?.modal_configured),
      baseten: Boolean(status?.baseten_configured),
      storage: Boolean(status?.storage_configured),
      updatedAt: status?.configuration_updated_at ?? null
    }
  };
}

function fallbackAccount(user: User): SafeAccountSummary {
  return {
    available: false,
    user: {
      id: user.id,
      email: user.email || "",
      displayName:
        metadataString(user, "full_name") ||
        metadataString(user, "name") ||
        user.email?.split("@")[0] ||
        "Forge user",
      avatarUrl: safeAvatarUrl(metadataString(user, "avatar_url"))
    },
    // Do not open an un-dismissable modal when account persistence is unavailable.
    onboardingSeen: true,
    onboardingSeenAt: null,
    providers: {
      modal: false,
      baseten: false,
      storage: false,
      updatedAt: null
    }
  };
}

function metadataString(user: User, key: string) {
  const value = user.user_metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeAvatarUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
