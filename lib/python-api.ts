import "server-only";

import { authenticateRequest } from "@/lib/auth";
import { pythonApiBase } from "@/lib/python-api-config";
import {
  readRequestBody,
  RequestBodyTooLargeError
} from "@/lib/request-body";

const MAX_PROXY_BODY_BYTES = 1024 * 1024;

export async function proxyToPython(
  request: Request,
  path: string,
  options: { maxBodyBytes?: number } = {}
) {
  const publicRequest = path === "/api/health" || path === "/health";
  const auth = publicRequest ? null : await authenticateRequest(request);
  if (!publicRequest && !auth) {
    return Response.json(
      { error: "Authentication required." },
      { status: 401, headers: noStoreHeaders() }
    );
  }

  const apiBase = pythonApiBase();
  const internalKey = process.env.INTERNAL_API_KEY?.trim();
  if (!apiBase || (process.env.APP_ENV === "production" && !internalKey)) {
    return Response.json(
      { error: "Forge API is not configured." },
      { status: 503, headers: noStoreHeaders() }
    );
  }

  const incoming = new URL(request.url);
  const target = new URL(`${apiBase}${path}`);
  target.search = incoming.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (internalKey) headers.set("x-forge-internal-key", internalKey);
  if (auth) {
    headers.set("x-forge-user-id", auth.user.id);
    if (auth.user.email) {
      headers.set("x-forge-user-email", auth.user.email);
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store"
  };
  if (!["GET", "HEAD"].includes(request.method)) {
    try {
      init.body = await readRequestBody(
        request,
        options.maxBodyBytes ?? MAX_PROXY_BODY_BYTES
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return Response.json(
          { error: "Request body is too large." },
          { status: 413, headers: noStoreHeaders() }
        );
      }
      return Response.json(
        { error: "Could not read request body." },
        { status: 400, headers: noStoreHeaders() }
      );
    }
  }

  let response: Response;
  try {
    response = await fetch(target, init);
  } catch {
    return Response.json(
      { error: "Forge API is temporarily unavailable." },
      { status: 503, headers: noStoreHeaders() }
    );
  }

  const responseHeaders = new Headers(noStoreHeaders());
  const responseContentType = response.headers.get("content-type");
  if (responseContentType) {
    responseHeaders.set("content-type", responseContentType);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}

function noStoreHeaders() {
  return {
    "Cache-Control":
      "private, no-cache, no-store, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0"
  };
}
