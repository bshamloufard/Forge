import type { ProviderHealth, ProviderMode } from "@/lib/types";

function modeFor(value: string | undefined): ProviderMode {
  return value && value.trim().length > 0 ? "configured" : "mock";
}

export function getProviderHealth(): ProviderHealth {
  return {
    modal: modeFor(process.env.MODAL_TOKEN_ID || process.env.MODAL_TOKEN_SECRET),
    baseten: modeFor(process.env.BASETEN_API_KEY),
    supabase: modeFor(
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
        (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
          process.env.SUPABASE_SECRET_KEY ||
          process.env.SUPABASE_SERVICE_ROLE_KEY)
    )
  };
}

export function providerNote(provider: keyof ProviderHealth) {
  const health = getProviderHealth();
  if (health[provider] === "configured") {
    return `${provider} keys detected; provider adapter is ready to replace mock execution.`;
  }
  return `${provider} keys missing; using deterministic mock execution for the MVP.`;
}

export async function createServingEndpoint(name: string, target: "baseten" | "modal") {
  const health = getProviderHealth();
  const mode = health[target];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  if (mode === "mock") {
    return {
      mode,
      endpointUrl: `https://mock.forge.local/v1/${target}/${slug || "checkpoint"}`
    };
  }

  return {
    mode,
    endpointUrl:
      target === "baseten"
        ? process.env.BASETEN_BASE_URL ||
          `https://model-${slug || "checkpoint"}.api.baseten.co/environments/production/sync/v1`
        : `https://${slug || "checkpoint"}--forge-modal.modal.run/v1`
  };
}
