import { verifyApplicationWorkerBody } from "@/lib/application-worker-auth";
import { readTextBody, RequestBodyError } from "@/lib/security/request-body";

export class ApplicationWorkerRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function readSignedApplicationWorkerJson(
  request: Request,
  maxBytes = 1_000_000,
): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw new ApplicationWorkerRequestError(
      "Content-Type must be application/json.",
      415,
    );
  let raw: string;
  try {
    raw = await readTextBody(request, maxBytes);
  } catch (error) {
    if (error instanceof RequestBodyError)
      throw new ApplicationWorkerRequestError(error.message, error.status);
    throw error;
  }
  if (
    !verifyApplicationWorkerBody({
      body: raw,
      timestamp: request.headers.get("x-ir35-worker-timestamp") ?? "",
      signature: request.headers.get("x-ir35-worker-signature") ?? "",
    })
  )
    throw new ApplicationWorkerRequestError("Invalid worker request.", 401);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApplicationWorkerRequestError(
      "Request body must contain valid JSON.",
      400,
    );
  }
}
