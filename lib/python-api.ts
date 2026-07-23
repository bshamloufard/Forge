import { getProviderHealth } from "@/lib/providers";
import {
  createSession,
  deployCheckpoint,
  forwardBackward,
  optimStep,
  readState,
  resetState,
  sampleFromSession,
  saveCheckpoint,
  verifyCandidate
} from "@/lib/store";

function pythonApiBase() {
  return (
    process.env.API_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:8000"
  ).replace(/\/$/, "");
}

export async function proxyToPython(request: Request, path: string) {
  const incoming = new URL(request.url);
  const target = new URL(`${pythonApiBase()}${path}`);
  target.search = incoming.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const authorization = request.headers.get("authorization");
  if (contentType) headers.set("content-type", contentType);
  if (authorization) headers.set("authorization", authorization);

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store"
  };
  let bodyText = "";
  if (!["GET", "HEAD"].includes(request.method)) {
    bodyText = await request.text();
    init.body = bodyText;
  }

  let response: Response;
  try {
    response = await fetch(target, init);
  } catch (error) {
    const fallback = await localFallbackResponse(request.method, path, bodyText);
    if (fallback) return fallback;
    throw error;
  }

  const responseHeaders = new Headers();
  const responseContentType = response.headers.get("content-type");
  if (responseContentType) responseHeaders.set("content-type", responseContentType);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}

async function localFallbackResponse(method: string, path: string, bodyText: string) {
  const body = parseBody(bodyText);
  const trainingRun = path.match(/^\/v1\/training-runs\/([^/]+)\/(forward-backward|optim-step)$/);

  try {
    if (method === "GET" && path === "/api/state") {
      return jsonResponse(await stateWithProviders());
    }
    if (method === "DELETE" && path === "/api/state") {
      await resetState();
      return jsonResponse(await stateWithProviders());
    }
    if (method === "GET" && path === "/api/health") {
      return jsonResponse({ ok: true, providers: getProviderHealth(), mode: "local-fallback" });
    }
    if (method === "POST" && ["/api/sessions", "/v1/sessions"].includes(path)) {
      return jsonResponse(await createSession(body));
    }
    if (method === "POST" && path === "/api/sample") {
      return jsonResponse(await sampleFromSession(body.sessionId, body.prompt));
    }
    if (method === "POST" && ["/api/verify", "/v1/verifier/verify", "/v1/verifier/score"].includes(path)) {
      return jsonResponse(await verifyCandidate(body));
    }
    if (method === "POST" && trainingRun?.[2] === "forward-backward") {
      return jsonResponse(await forwardBackward(trainingRun[1], body.microbatches));
    }
    if (method === "POST" && trainingRun?.[2] === "optim-step") {
      return jsonResponse(await optimStep(trainingRun[1]));
    }
    if (method === "POST" && path === "/api/training/forward_backward") {
      return jsonResponse(await forwardBackward(body.runId, body.microbatches));
    }
    if (method === "POST" && path === "/api/training/optim_step") {
      return jsonResponse(await optimStep(body.runId));
    }
    if (method === "POST" && ["/api/checkpoints", "/v1/checkpoints"].includes(path)) {
      return jsonResponse(await saveCheckpoint(body.runId, body.name));
    }
    if (method === "POST" && ["/api/deployments", "/v1/deployments"].includes(path)) {
      return jsonResponse(await deployCheckpoint(body.checkpointId, body.target));
    }
    if (method === "GET" && path === "/v1/sessions") {
      const state = await readState();
      return jsonResponse({ sessions: state.sessions });
    }
    if (method === "GET" && path === "/v1/runs") {
      const state = await readState();
      return jsonResponse({ runs: state.runs });
    }
    if (method === "GET" && ["/api/checkpoints", "/v1/checkpoints"].includes(path)) {
      const state = await readState();
      return jsonResponse({ checkpoints: state.checkpoints });
    }
    if (method === "GET" && ["/api/deployments", "/v1/deployments"].includes(path)) {
      const state = await readState();
      return jsonResponse({ deployments: state.deployments });
    }
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Local fallback failed" },
      500
    );
  }

  return null;
}

async function stateWithProviders() {
  return { ...(await readState()), providers: getProviderHealth() };
}

function parseBody(bodyText: string) {
  if (!bodyText) return {};
  try {
    return JSON.parse(bodyText);
  } catch {
    return {};
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return Response.json(payload, { status });
}
