import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

export type ProviderReadiness = {
  modal: boolean;
  baseten: boolean;
  storage: boolean;
  modalCredentialsStored: boolean;
  basetenCredentialsStored: boolean;
  modalConnectionState: string;
  basetenConnectionState: string;
  modalWorkerState: string;
  modalWorkerRevision: string | null;
  modalCheckedAt: string | null;
  basetenCheckedAt: string | null;
  modalIssue: string | null;
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
  modal_credentials_present?: boolean;
  baseten_credentials_present?: boolean;
  modal_connection_state?: string;
  baseten_connection_state?: string;
  modal_worker_state?: string;
  modal_worker_revision?: string | null;
  modal_validation_checked_at?: string | null;
  baseten_validation_checked_at?: string | null;
  modal_worker_error_code?: string | null;
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
  const expectedModalWorkerRevision =
    process.env.FORGE_MODAL_WORKER_REVISION?.trim() ||
    "forge-worker-20260724.1";
  const modalReady =
    Boolean(status?.modal_configured) &&
    status?.modal_worker_revision === expectedModalWorkerRevision;

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
      modal: modalReady,
      baseten: Boolean(status?.baseten_configured),
      storage: Boolean(status?.storage_configured),
      modalCredentialsStored: Boolean(
        status?.modal_credentials_present ?? status?.modal_configured
      ),
      basetenCredentialsStored: Boolean(
        status?.baseten_credentials_present ?? status?.baseten_configured
      ),
      modalConnectionState:
        status?.modal_connection_state ||
        (status?.modal_configured ? "valid" : "missing"),
      basetenConnectionState:
        status?.baseten_connection_state ||
        (status?.baseten_configured ? "valid" : "missing"),
      modalWorkerState:
        status?.modal_worker_state ||
        (status?.modal_configured ? "ready" : "missing"),
      modalWorkerRevision: status?.modal_worker_revision ?? null,
      modalCheckedAt: status?.modal_validation_checked_at ?? null,
      basetenCheckedAt: status?.baseten_validation_checked_at ?? null,
      modalIssue: status?.modal_worker_error_code ?? null,
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
      modalCredentialsStored: false,
      basetenCredentialsStored: false,
      modalConnectionState: "missing",
      basetenConnectionState: "missing",
      modalWorkerState: "missing",
      modalWorkerRevision: null,
      modalCheckedAt: null,
      basetenCheckedAt: null,
      modalIssue: null,
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
