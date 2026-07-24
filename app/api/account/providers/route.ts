import { z } from "zod";
import { getAccountSummary } from "@/lib/account";
import { authenticateRequest } from "@/lib/auth";
import {
  readRequestText,
  RequestBodyTooLargeError
} from "@/lib/request-body";
import { configureProviders } from "@/lib/provider-validation";

export const dynamic = "force-dynamic";

const optionalSecret = z
  .string()
  .trim()
  .max(16_384)
  .refine((value) => !value || /^[\x21-\x7e]+$/.test(value), {
    message: "Use a provider credential containing visible ASCII characters only."
  })
  .optional()
  .default("");
const optionalSetting = (maximum: number) =>
  z.string().trim().max(maximum).optional().default("");

const providerInputSchema = z
  .object({
    modalTokenId: optionalSecret,
    modalTokenSecret: optionalSecret,
    basetenApiKey: optionalSecret,
    modalEnvironment: optionalSetting(64),
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

    if (
      value.modalEnvironment &&
      (!/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(value.modalEnvironment) ||
        value.modalEnvironment.toLowerCase().startsWith("en-"))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modalEnvironment"],
        message:
          "Use a valid Modal environment name that does not start with en-."
      });
    }
    if (
      value.basetenModelId &&
      !/^[A-Za-z0-9._:/-]+$/.test(value.basetenModelId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["basetenModelId"],
        message: "Use a valid Baseten model identifier."
      });
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
  const configuration = await configureProviders(auth.user, input);
  if (!configuration.ok) {
    return Response.json(
      {
        error: configuration.error,
        fieldErrors: configuration.fieldErrors
      },
      {
        status: configuration.status,
        headers: noStoreHeaders()
      }
    );
  }

  const account = await getAccountSummary(auth.supabase, auth.user);
  return Response.json(
    { account, verification: configuration.summary },
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
