import "server-only";

import { pythonApiBase } from "@/lib/python-api-config";

type ProviderConfigurationInput = {
  modalTokenId: string;
  modalTokenSecret: string;
  basetenApiKey: string;
  modalEnvironment: string;
  basetenModelId: string;
};

export type ProviderSetupResult = {
  status: "ready" | "invalid" | "unavailable" | "conflict";
  code: string;
  message: string;
  provisioned: boolean;
};

export type ProviderSetupSummary = {
  modal: ProviderSetupResult | null;
  baseten: ProviderSetupResult | null;
};

export type ProviderConfigurationResult =
  | {
      ok: true;
      summary: ProviderSetupSummary;
    }
  | {
      ok: false;
      status: number;
      error: string;
      fieldErrors: Partial<
        Record<keyof ProviderConfigurationInput, string[]>
      >;
    };

export async function configureProviders(
  user: { id: string; email?: string | null },
  input: ProviderConfigurationInput
): Promise<ProviderConfigurationResult> {
  const payload: Record<string, string> = {};
  if (input.modalTokenId) payload.modal_token_id = input.modalTokenId;
  if (input.modalTokenSecret) {
    payload.modal_token_secret = input.modalTokenSecret;
  }
  if (input.modalEnvironment) {
    payload.modal_environment = input.modalEnvironment;
  }
  if (input.basetenApiKey) payload.baseten_api_key = input.basetenApiKey;
  if (input.basetenModelId) {
    payload.baseten_model_id = input.basetenModelId;
  }

  if (!Object.keys(payload).length) {
    return {
      ok: false,
      status: 400,
      error: "Enter at least one provider setting.",
      fieldErrors: {}
    };
  }

  const service = providerService();
  if (!service) return unavailableConfiguration();

  let response: Response;
  try {
    response = await fetch(`${service.apiBase}/v1/providers/configure`, {
      method: "POST",
      headers: providerHeaders(service.internalKey, user),
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(20 * 60 * 1000)
    });
  } catch {
    return unavailableConfiguration();
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return unavailableConfiguration();
  }

  if (!response.ok) {
    const candidate =
      responseBody && typeof responseBody === "object"
        ? (responseBody as Record<string, unknown>)
        : {};
    const error =
      typeof candidate.error === "string"
        ? candidate.error
        : "Provider setup failed. No unverified change was saved.";
    const field = providerField(candidate.field);
    return {
      ok: false,
      status: response.status,
      error,
      fieldErrors: field ? { [field]: [error] } : {}
    };
  }

  if (!isSetupResponse(responseBody)) {
    return unavailableConfiguration();
  }
  return {
    ok: true,
    summary: {
      modal: responseBody.modal,
      baseten: responseBody.baseten
    }
  };
}

export async function retryModalSetup(
  user: { id: string; email?: string | null }
): Promise<
  | { ok: true; modal: ProviderSetupResult }
  | { ok: false; status: number; error: string }
> {
  const service = providerService();
  if (!service) {
    return {
      ok: false,
      status: 503,
      error: "Modal setup is temporarily unavailable."
    };
  }

  let response: Response;
  try {
    response = await fetch(
      `${service.apiBase}/v1/providers/modal/provision`,
      {
        method: "POST",
        headers: providerHeaders(service.internalKey, user),
        cache: "no-store",
        signal: AbortSignal.timeout(20 * 60 * 1000)
      }
    );
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Modal setup is temporarily unavailable."
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (
    response.ok &&
    body &&
    typeof body === "object" &&
    isSetupResult((body as Record<string, unknown>).modal)
  ) {
    return {
      ok: true,
      modal: (body as { modal: ProviderSetupResult }).modal
    };
  }

  const error =
    body &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>).error === "string"
      ? String((body as Record<string, unknown>).error)
      : body &&
          typeof body === "object" &&
          isSetupResult((body as Record<string, unknown>).modal)
        ? (body as { modal: ProviderSetupResult }).modal.message
      : "Modal setup did not complete. Retry in a moment.";
  return { ok: false, status: response.status || 503, error };
}

function providerService() {
  const apiBase = pythonApiBase();
  const internalKey = process.env.INTERNAL_API_KEY?.trim();
  if (!apiBase || (process.env.APP_ENV === "production" && !internalKey)) {
    return null;
  }
  return { apiBase, internalKey };
}

function providerHeaders(
  internalKey: string | undefined,
  user: { id: string; email?: string | null }
) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Forge-User-Id": user.id
  });
  if (user.email) headers.set("X-Forge-User-Email", user.email);
  if (internalKey) headers.set("X-Forge-Internal-Key", internalKey);
  return headers;
}

function unavailableConfiguration(): ProviderConfigurationResult {
  return {
    ok: false,
    status: 503,
    error:
      "Provider setup is temporarily unavailable. No unverified change was saved.",
    fieldErrors: {}
  };
}

function providerField(
  value: unknown
): keyof ProviderConfigurationInput | null {
  return [
    "modalTokenId",
    "modalTokenSecret",
    "basetenApiKey",
    "modalEnvironment",
    "basetenModelId"
  ].includes(String(value))
    ? (value as keyof ProviderConfigurationInput)
    : null;
}

function isSetupResponse(
  value: unknown
): value is {
  saved: true;
  modal: ProviderSetupResult | null;
  baseten: ProviderSetupResult | null;
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.saved === true &&
    isSetupResultOrNull(candidate.modal) &&
    isSetupResultOrNull(candidate.baseten)
  );
}

function isSetupResultOrNull(
  value: unknown
): value is ProviderSetupResult | null {
  return value === null || isSetupResult(value);
}

function isSetupResult(value: unknown): value is ProviderSetupResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    ["ready", "invalid", "unavailable", "conflict"].includes(
      String(candidate.status)
    ) &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.provisioned === "boolean"
  );
}
