import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const founderEmail = (
  process.env.FORGE_FOUNDER_EMAIL || "bshamloufard@berkeley.edu"
).trim().toLowerCase();
const supabaseUrl = requireValue("SUPABASE_URL", process.env.SUPABASE_URL);
const serviceKey = requireValue(
  "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY",
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);
const modalTokenId = requireValue("MODAL_TOKEN_ID", process.env.MODAL_TOKEN_ID);
const modalTokenSecret = requireValue(
  "MODAL_TOKEN_SECRET",
  process.env.MODAL_TOKEN_SECRET
);
const basetenApiKey = requireValue("BASETEN_API_KEY", process.env.BASETEN_API_KEY);

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

let founder = await findUserByEmail(founderEmail);
if (!founder) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: founderEmail,
    email_confirm: true,
    app_metadata: { forge_role: "founder" }
  });
  if (error || !data.user) {
    throw new Error(`Could not create founder account: ${error?.message || "unknown error"}`);
  }
  founder = data.user;
} else {
  const { error } = await supabase.auth.admin.updateUserById(founder.id, {
    app_metadata: {
      ...founder.app_metadata,
      forge_role: "founder"
    }
  });
  if (error) throw new Error(`Could not update founder account: ${error.message}`);
}

const { error: bootstrapError } = await supabase.rpc(
  "bootstrap_provider_credentials_for_service",
  {
    p_user_id: founder.id,
    p_modal_token_id: modalTokenId,
    p_modal_token_secret: modalTokenSecret,
    p_baseten_api_key: basetenApiKey,
    p_modal_app_name: process.env.MODAL_APP_NAME || "forge-mvp",
    p_modal_environment: process.env.MODAL_ENVIRONMENT || "main",
    p_baseten_base_url:
      process.env.BASETEN_BASE_URL || "https://inference.baseten.co/v1",
    p_baseten_model_id:
      process.env.BASETEN_MODEL_ID ||
      process.env.BASETEN_DEFAULT_MODEL ||
      "zai-org/GLM-5.2-Fast"
  }
);
if (bootstrapError) {
  throw new Error(`Could not save founder provider configuration: ${bootstrapError.message}`);
}

const { data: credentialRows, error: credentialError } = await supabase.rpc(
  "get_provider_credentials_for_service",
  { p_user_id: founder.id }
);
if (credentialError) {
  throw new Error(`Could not verify founder provider configuration: ${credentialError.message}`);
}
const credentials = Array.isArray(credentialRows) ? credentialRows[0] : credentialRows;
if (
  !credentials?.modal_token_id ||
  !credentials?.modal_token_secret ||
  !credentials?.baseten_api_key
) {
  throw new Error("Founder provider configuration verification failed");
}

const statePath = `user-state/${founder.id}/forge-state.json`;
const { data: existingState, error: stateDownloadError } = await supabase.storage
  .from("checkpoints")
  .download(statePath);
if (stateDownloadError && !isMissingObject(stateDownloadError)) {
  throw new Error(`Could not inspect founder state: ${stateDownloadError.message}`);
}
if (!existingState) {
  const createdAt = new Date().toISOString();
  const initialState = {
    project: {
      id: "proj_default",
      name: "Forge Research",
      organization: founderEmail,
      createdAt
    },
    sessions: [],
    runs: [],
    checkpoints: [],
    deployments: [],
    verifierScores: []
  };
  const { error: stateUploadError } = await supabase.storage
    .from("checkpoints")
    .upload(statePath, Buffer.from(JSON.stringify(initialState, null, 2)), {
      contentType: "application/json",
      upsert: false
    });
  if (stateUploadError) {
    throw new Error(`Could not initialize founder state: ${stateUploadError.message}`);
  }
}

console.log(`Founder account bootstrapped for ${founderEmail}; secrets verified and redacted.`);

async function findUserByEmail(email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100
    });
    if (error) throw new Error(`Could not list Supabase users: ${error.message}`);
    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === email
    );
    if (match) return match;
    if (data.users.length < 100) return null;
  }
  throw new Error("Founder lookup exceeded the supported pagination window");
}

function requireValue(name, value) {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function isMissingObject(error) {
  return error?.statusCode === "404" || error?.status === 404;
}
