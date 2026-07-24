import "server-only";

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readRequestBody(
  request: Request,
  maximumBytes: number
): Promise<ArrayBuffer> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isFinite(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maximumBytes
    ) {
      throw new RequestBodyTooLargeError();
    }
  }

  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

export async function readRequestText(
  request: Request,
  maximumBytes: number
) {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await readRequestBody(request, maximumBytes)
  );
}
