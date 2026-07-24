import { z } from "zod";
import { getAccountSummary } from "@/lib/account";
import { authenticateRequest } from "@/lib/auth";
import {
  readRequestText,
  RequestBodyTooLargeError
} from "@/lib/request-body";

export const dynamic = "force-dynamic";

const optionalSecret = z.string().trim().max(16_384).optional().default("");
const optionalSetting = (maximum: number) =>
  z.string().trim().max(maximum).optional().default("");

const providerInputSchema = z
  .object({
    modalTokenId: optionalSecret,
    modalTokenSecret: optionalSecret,
    basetenApiKey: optionalSecret,
    modalAppName: optionalSetting(255),
    modalEnvironment: optionalSetting(255),
    basetenModelId: optionalSetting(512)
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.modalTokenId) !== Boolean(value.modalTokenSecret)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modalTokenSecret"],
        message: "Modal token ID and token secret must be replaced together."
      });
    }

    for (const [field, setting] of [
      ["modalAppName", value.modalAppName],
      ["modalEnvironment", value.modalEnvironment]
    ] as const) {
      if (setting && !/^[A-Za-z0-9._-]+$/.test(setting)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "Use only letters, numbers, dots, underscores, and hyphens."
        });
      }
    }
  });

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);

  let body: unknown;
  try {
    const rawBody = await readRequestText(request, 65_536);
    body = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonError("Provider configuration is too large.", 413);
    }
    return jsonError("A valid JSON body is required.", 400);
  }

  const parsed = providerInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Check the provider fields and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors
      },
      {
        status: 400,
        headers: noStoreHeaders()
      }
    );
  }

  const input = parsed.data;
  const { error } = await auth.supabase.rpc("save_provider_credentials", {
    p_modal_token_id: input.modalTokenId || null,
    p_modal_token_secret: input.modalTokenSecret || null,
    p_baseten_api_key: input.basetenApiKey || null,
    p_modal_app_name: input.modalAppName || null,
    p_modal_environment: input.modalEnvironment || null,
    // This stays server-controlled until provider egress has an allowlist.
    p_baseten_base_url: null,
    p_baseten_model_id: input.basetenModelId || null
  });

  if (error) {
    return jsonError("Could not save provider configuration.", 503);
  }

  const account = await getAccountSummary(auth.supabase, auth.user);
  return Response.json(
    { account },
    {
      headers: noStoreHeaders()
    }
  );
}

function jsonError(error: string, status: number) {
  return Response.json(
    { error },
    {
      status,
      headers: noStoreHeaders()
    }
  );
}

function noStoreHeaders() {
  return {
    "Cache-Control":
      "private, no-cache, no-store, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0"
  };
}
