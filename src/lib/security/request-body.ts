export class RequestBodyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RequestBodyError";
  }
}

function declaredLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null || value === "") return null;
  if (!/^\d+$/.test(value)) throw new RequestBodyError("The Content-Length header is invalid.", 400);
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length < 0) throw new RequestBodyError("The Content-Length header is invalid.", 400);
  return length;
}

export async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = declaredLength(request);
  if (declared !== null && declared > maxBytes) throw new RequestBodyError("Request payload is too large.", 413);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyError("Request payload is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readTextBody(request: Request, maxBytes: number): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(await readBodyBytes(request, maxBytes));
}

export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType && contentType !== "application/json") {
    throw new RequestBodyError("Content-Type must be application/json.", 415);
  }
  const raw = await readTextBody(request, maxBytes);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new RequestBodyError("Request body must contain valid JSON.", 400);
  }
}

export async function readFormDataBody(request: Request, maxBytes: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new RequestBodyError("Content-Type must be multipart/form-data.", 415);
  }
  const bytes = await readBodyBytes(request, maxBytes);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const bounded = new Request("https://request.invalid", {
    method: "POST",
    headers: { "content-type": contentType, "content-length": String(bytes.byteLength) },
    body,
  });
  try {
    return await bounded.formData();
  } catch {
    throw new RequestBodyError("The multipart request body is invalid.", 400);
  }
}

export function requestBodyErrorResponse(error: unknown, headers: HeadersInit = {}): Response | null {
  return error instanceof RequestBodyError
    ? Response.json({ error: error.message }, { status: error.status, headers })
    : null;
}
