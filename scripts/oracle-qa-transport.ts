/** RAM-only browser transport to an owned private fixture, not the public edge.
 * The controller must attest the SSH tunnel and fixture before calling this.
 * Returned bodies/headers may contain sessions: NEVER log or journal them.
 */
import { request, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http";
import { z } from "zod";

export const QA_ORIGIN = "https://staging.ir35careers.com";
const tunnelSchema = z.strictObject({ host: z.literal("127.0.0.1"), port: z.number().int().min(1024).max(65535), fixture: z.literal("webqa01") });
const credentialSchema = z.strictObject({ username: z.literal("ir35"), password: z.string().regex(/^[a-f0-9]{48}$/) });
export type QaTunnel = z.infer<typeof tunnelSchema>;
export type QaCredentials = z.infer<typeof credentialSchema>;
export type QaReply = { status: number; headers: IncomingHttpHeaders; body: Buffer };
export type QaRequester = (options: RequestOptions, callback: (reply: IncomingMessage) => void) => ClientRequest;

const pages = /^\/(?:jobs(?:\/[a-f0-9-]{36})?|tools\/(?:ir35-status|take-home)|account(?:\/reset)?|auth\/callback|onboarding|dashboard|pricing|resources|research|profile|settings|saved|inbox|applications(?:\/new\/[a-f0-9-]{36})?|automation|contact|privacy|terms|cookies|changelog|stories|blog(?:\/[a-z0-9-]+)?|contracts\/[a-z0-9-]+)?$/;
const assets = /^\/(?:_next\/(?:static|image)\/?.*|brand\/.*|images\/.*|logos\/.*|(?:favicon\.ico|icon\.png|apple-icon\.png|robots\.txt|sitemap\.xml|llms\.txt)|sitemap\/[a-z0-9_.-]+)$/;
const apiReads = /^\/api\/(?:health|jobs\/search|jobs\/[a-f0-9-]{36}|applications\/(?:submission-status|worker\/status))$/;
const apiWrites = new Set(["/api/applications/prepare", "/api/applications/submit", "/api/resume/parse", "/api/resume/export"]);
const auth = /^\/supabase\/auth\/v1\/(?:health|settings|user|signup|token|otp|recover|verify|logout|\.well-known\/jwks\.json)$/;
const restReads = /^\/supabase\/rest\/v1\/[a-z_]+$/;
const restWrites = new Set(["profiles", "saved_jobs", "application_packets", "application_events"]);

/** Narrow browser allowlist. No cron, queue control, billing, provider login,
 * ingestion, email integration, employer URL or generic RPC action permission.
 * RLS negative cases still reach the real fixture server, not a mocked denial.
 */
export function qaBrowserUrl(input: unknown, method: unknown): URL | null {
  if (typeof input !== "string" || input.length > 16_384 || /[\\\r\n\0]/.test(input)
    || typeof method !== "string" || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) return null;
  try {
    const url = new URL(input);
    if (url.origin !== QA_ORIGIN || url.username || url.password || url.hash || /%(?:00|0a|0d|2f|5c)/i.test(url.pathname)) return null;
    const read = method === "GET" || method === "HEAD";
    if (url.pathname === "/_next/image") {
      const image = url.searchParams.get("url");
      // A local image URL must be a static asset, never a recursive optimiser
      // or an internal action route that happens to be on the same origin.
      if (!image || !/^\/(?:brand|images|logos)\/[a-z0-9_./-]+$/i.test(image) || image.includes("..")) return null;
    }
    if (read && (pages.test(url.pathname) || assets.test(url.pathname) || apiReads.test(url.pathname))) return url;
    if (method === "POST" && apiWrites.has(url.pathname)) return url;
    if (auth.test(url.pathname)) return url;
    if (read && restReads.test(url.pathname)) return url;
    if (url.pathname === "/supabase/rest/v1/rpc/save_application_draft" && method === "POST") return url;
    const relation = /^\/supabase\/rest\/v1\/([a-z_]+)$/.exec(url.pathname)?.[1];
    if (relation && restWrites.has(relation) && ["POST", "PATCH", "DELETE"].includes(method)) return url;
    if (/^\/supabase\/storage\/v1\/(?:status|object(?:\/.*)?|bucket(?:\/.*)?)$/.test(url.pathname)
      && (read || method === "POST")) return url;
    return null;
  } catch { return null; }
}

export function qaRedirectAllowed(location: string, from: URL): boolean {
  try {
    if (typeof location !== "string" || location.length > 16_384 || /[\\\r\n\0]/.test(location)) return false;
    const next = new URL(location, from);
    // GoTrue may return a SAME-origin session fragment. It remains RAM/browser
    // only and is not part of the HTTP request; do not break actual Auth flow.
    if (next.hash && !["/", "/auth/callback", "/account/reset"].includes(next.pathname)) return false;
    next.hash = "";
    return qaBrowserUrl(next.href, "GET") !== null;
  }
  catch { return false; }
}

function headersFor(url: URL, input: Record<string, string>, basic: string): Record<string, string> {
  const output: Record<string, string> = {};
  let size = 0;
  for (const [name, value] of Object.entries(input)) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || typeof value !== "string" || /[\r\n\0]/.test(value))
      throw new Error("QaHeaderBoundaryRejected");
    size += name.length + value.length;
    if (size > 65_536) throw new Error("QaHeaderBoundaryRejected");
    const key = name.toLowerCase();
    if (/^(?:host|origin|referer|connection|upgrade|proxy-authorization|x-staging-authorization|x-http-method-override|x-real-ip|forwarded|x-forwarded-.*|x-vercel-.*|sec-websocket-.*)$/.test(key)) continue;
    output[key] = value;
  }
  output.host = "staging.ir35careers.com";
  output.origin = QA_ORIGIN; output.referer = QA_ORIGIN + "/";
  output["accept-encoding"] = "identity";
  if (!url.pathname.startsWith("/supabase/")) {
    // Private edge must authenticate X-Staging-Authorization, then restore the
    // user's Bearer header for app APIs. Never replace it with Basic.
    output["x-staging-authorization"] = basic;
    if (!output.authorization?.startsWith("Bearer ")) output.authorization = basic;
  }
  return output;
}

/** Header rewrite for route.continue(). The browser keeps native TLS, cookies,
 * redirects and WebSockets through the local CONNECT tunnel; no fulfilled or
 * fabricated Auth response is involved. Never log the returned dictionary.
 */
export function qaBrowserHeaders(input: unknown, method: unknown, headers: Record<string, string>, credentialInput: unknown): Record<string, string> {
  const url = qaBrowserUrl(input, method), credentials = credentialSchema.safeParse(credentialInput);
  if (!url || !credentials.success) throw new Error("QaBrowserHeaderBoundaryRejected");
  return headersFor(url, headers, "Basic " + Buffer.from(credentials.data.username + ":" + credentials.data.password).toString("base64"));
}

/** Single request, no auto-follow/retry; TLS verification is never disabled.
 * Injected requester is ONLY for offline fixtures; the runtime default is HTTPS.
 */
export async function qaTunnelRequest(input: unknown, init: { method: string; headers?: Record<string, string>; body?: Buffer },
  tunnelInput: unknown, credentialInput: unknown, requester: QaRequester = request): Promise<QaReply> {
  const url = qaBrowserUrl(input, init.method), tunnel = tunnelSchema.safeParse(tunnelInput), credentials = credentialSchema.safeParse(credentialInput);
  if (!url || !tunnel.success || !credentials.success || (init.body && (!Buffer.isBuffer(init.body) || init.body.length > 2_097_152)))
    throw new Error("QaTunnelRequestBoundaryRejected");
  const basic = "Basic " + Buffer.from(credentials.data.username + ":" + credentials.data.password).toString("base64");
  const headers = headersFor(url, init.headers ?? {}, basic);
  return new Promise((resolve, reject) => {
    let settled = false, client: ClientRequest | undefined;
    const fail = (code: string) => {
      if (settled) return; settled = true; clearTimeout(deadline);
      client?.destroy(); reject(new Error(code));
    };
    const deadline = setTimeout(() => fail("QaTunnelRequestDeadline"), 30_000);
    try {
      client = requester({ hostname: "127.0.0.1", port: tunnel.data.port, servername: "staging.ir35careers.com",
        rejectUnauthorized: true, method: init.method, path: url.pathname + url.search, headers, agent: false }, incoming => {
        const status = incoming.statusCode;
        if (typeof status !== "number" || status < 100 || status > 599) { incoming.destroy(); fail("QaTunnelResponseRejected"); return; }
        if (status >= 300 && status < 400 && (!incoming.headers.location || !qaRedirectAllowed(incoming.headers.location, url))) {
          incoming.destroy(); fail("QaExternalRedirectRejected"); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        incoming.on("data", (chunk: Buffer) => {
          if (settled) return;
          if (!Buffer.isBuffer(chunk)) { incoming.destroy(); fail("QaTunnelResponseBound"); return; }
          size += chunk.length;
          if (size > 16_777_216) { incoming.destroy(); fail("QaTunnelResponseBound"); return; }
          chunks.push(chunk);
        });
        incoming.once("error", () => fail("QaTunnelResponseFailed_RawWithheld"));
        incoming.once("aborted", () => fail("QaTunnelResponseFailed_RawWithheld"));
        incoming.once("close", () => { if (!settled) fail("QaTunnelResponseFailed_RawWithheld"); });
        incoming.once("end", () => {
          if (settled) return; settled = true; clearTimeout(deadline);
          resolve({ status, headers: incoming.headers, body: Buffer.concat(chunks) });
        });
      });
      client.once("error", () => fail("QaTunnelRequestFailed_RawWithheld"));
      client.end(init.body);
    } catch { fail("QaTunnelRequestFailed_RawWithheld"); }
  });
}
