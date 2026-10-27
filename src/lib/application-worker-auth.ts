import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export function applicationWorkerAppOrigin(value?: string): string {
  const url = new URL(value || "https://www.ir35careers.com");
  if (url.protocol !== "https:")
    throw new Error("IR35Careers worker origin must use HTTPS.");
  return url.origin;
}

/** Stored callbacks use the operator's app origin, never a request Host header.
 * A staging app cannot silently write a production callback into its task row.
 */
export function applicationWorkerCallbackUrl(
  env: Record<string, string | undefined> = process.env,
): URL {
  const staging = z.enum(["true", "false"]).default("false").safeParse(env.IR35_STAGING);
  const raw = env.IR35CAREERS_APP_URL || "https://www.ir35careers.com";
  // Check BEFORE URL/Zod normalisation can discard ASCII control characters.
  if (typeof raw !== "string" || /[\u0000-\u0020\u007f]/.test(raw))
    throw new Error("Invalid application worker callback configuration.");
  const configured = z.string().url().safeParse(raw);
  if (!staging.success || !configured.success)
    throw new Error("Invalid application worker callback configuration.");
  let origin: URL;
  try { origin = new URL(configured.data); }
  catch { throw new Error("Invalid application worker callback configuration."); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/"
    || origin.search || origin.hash || /[\r\n\u0000]/.test(configured.data)
    || (staging.data === "true" && (env.VERCEL === "1" || origin.origin !== "https://staging.ir35careers.com"))
    || (staging.data === "false" && origin.origin === "https://staging.ir35careers.com"))
    throw new Error("Invalid application worker callback configuration.");
  return new URL("/api/applications/worker/callback", origin.origin);
}

function workerSecret(): string {
  const secret = process.env.APPLICATION_WORKER_SECRET?.trim();
  if (!secret || secret.length < 32)
    throw new Error(
      "APPLICATION_WORKER_SECRET must contain at least 32 characters.",
    );
  return secret;
}

export function applicationWorkerConfig(): {
  enabled: boolean;
  url?: string;
} {
  if (process.env.APPLICATION_WORKER_ENABLED?.toLowerCase() !== "true")
    return { enabled: false };
  if ((process.env.APPLICATION_WORKER_SECRET?.trim().length ?? 0) < 32)
    return { enabled: false };
  const value = process.env.APPLICATION_WORKER_URL?.trim();
  if (!value) return { enabled: true };
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return { enabled: false };
    return { enabled: true, url: url.toString().replace(/\/$/, "") };
  } catch {
    return { enabled: false };
  }
}

export function signApplicationWorkerBody(
  body: string,
  timestamp = Date.now().toString(),
): { timestamp: string; signature: string } {
  const signature = createHmac("sha256", workerSecret())
    .update(`${timestamp}.${body}`)
    .digest("base64url");
  return { timestamp, signature };
}

export function verifyApplicationWorkerBody(input: {
  body: string;
  timestamp: string;
  signature: string;
  now?: number;
}): boolean {
  const parsedTimestamp = Number(input.timestamp);
  if (
    !Number.isFinite(parsedTimestamp) ||
    Math.abs((input.now ?? Date.now()) - parsedTimestamp) > MAX_CLOCK_SKEW_MS
  )
    return false;
  let expected: string;
  try {
    expected = signApplicationWorkerBody(
      input.body,
      input.timestamp,
    ).signature;
  } catch {
    return false;
  }
  const suppliedBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}
