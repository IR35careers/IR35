import { createHmac, timingSafeEqual } from "node:crypto";
import { request } from "node:http";
import { isIP } from "node:net";
import { z } from "zod";
import { resolvePrivateNetworkAddress } from "./database-connection";
import { mockWebPolicy, mockWebClaimOrHeartbeatSchema, mockWebResultSchema } from "./mock-web-policy";

export const MOCK_WEB_CLAIM_PATH = "/api/applications/worker/claim";
export const MOCK_WEB_CALLBACK_PATH = "/api/applications/worker/callback";
const paths = z.enum([MOCK_WEB_CLAIM_PATH, MOCK_WEB_CALLBACK_PATH]);
const MAX_BYTES = 16_384;
const UNAVAILABLE = "The isolated mock control plane is unavailable; no submission is confirmed.";

export function mockWebSignature(secret: string, timestamp: string, method: string, path: string, body: string): string {
  return createHmac("sha256", secret).update(`ir35-staging-web-mock-v1.${timestamp}.${method}.${path}.${body}`).digest("base64url");
}

export function verifyMockWebSignature(input: {
  secret: string; timestamp: unknown; signature: unknown; method: string; path: string; body: string; now?: number;
}): boolean {
  if (typeof input.timestamp !== "string" || !/^\d{13}$/.test(input.timestamp)
    || Math.abs((input.now ?? Date.now()) - Number(input.timestamp)) > 30_000
    || typeof input.signature !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.signature)
    || input.method !== "POST" || !paths.safeParse(input.path).success
    || Buffer.byteLength(input.body) > MAX_BYTES || input.secret.length < 32 || input.secret.length > 256) return false;
  const expected = Buffer.from(mockWebSignature(input.secret, input.timestamp, input.method, input.path, input.body));
  const actual = Buffer.from(input.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Private, operator-pinned Docker/loopback HTTP only. Carries opaque mock IDs,
 * never bearer tokens, Basic credentials, CVs or the HMAC key itself. Public
 * staging Basic/TLS controls stay unchanged; redirects are NEVER followed.
 */
export async function mockWebInternalPost(path: unknown, value: unknown,
  env: Record<string, string | undefined> = process.env): Promise<unknown> {
  try {
    if (!mockWebPolicy(env) || !paths.safeParse(path).success) throw new Error();
    const fixedPath = paths.parse(path);
    const payload = (fixedPath === MOCK_WEB_CLAIM_PATH ? mockWebClaimOrHeartbeatSchema : mockWebResultSchema).safeParse(value);
    if (!payload.success) throw new Error();
    const raw = env.IR35_MOCK_WEB_INTERNAL_URL;
    const allowed = env.IR35_MOCK_WEB_INTERNAL_HOST;
    if (!raw || !allowed || /[\u0000-\u0020\u007f]/.test(raw) || allowed.length > 253
      || (!isIP(allowed) && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(allowed))) throw new Error();
    const base = new URL(raw);
    const host = base.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (base.protocol !== "http:" || base.username || base.password || base.pathname !== "/"
      || base.search || base.hash || host !== allowed.toLowerCase() || !base.port) throw new Error();
    // SAME all-address private check as the queue, then connect to the exact
    // numeric result: no second DNS resolution/rebinding window.
    const address = await resolvePrivateNetworkAddress(host);
    const body = JSON.stringify(payload.data);
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error();
    const timestamp = Date.now().toString();
    const signature = mockWebSignature(env.APPLICATION_WORKER_SECRET!, timestamp, "POST", fixedPath, body);
    return await new Promise<unknown>((resolve, reject) => {
      const call = request({ hostname: address, port: Number(base.port), path: fixedPath, method: "POST", agent: false,
        headers: { host: base.host, "content-type": "application/json", "content-length": Buffer.byteLength(body),
          "x-ir35-web-mock-timestamp": timestamp, "x-ir35-web-mock-signature": signature } }, response => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) { call.destroy(); reject(new Error(UNAVAILABLE)); return; }
          chunks.push(chunk);
        });
        response.on("error", () => reject(new Error(UNAVAILABLE)));
        response.on("aborted", () => reject(new Error(UNAVAILABLE)));
        response.on("end", () => {
          if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) { reject(new Error(UNAVAILABLE)); return; }
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { reject(new Error(UNAVAILABLE)); }
        });
      });
      const deadline = setTimeout(() => call.destroy(new Error(UNAVAILABLE)), 10_000);
      deadline.unref();
      call.once("close", () => clearTimeout(deadline));
      call.once("error", () => reject(new Error(UNAVAILABLE)));
      call.end(body);
    });
  } catch { throw new Error(UNAVAILABLE); }
}
