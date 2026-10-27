import { z } from "zod";

export const STAGING_BROWSER_ORIGIN = "https://staging.ir35careers.com";
export const stagingBrowserBootstrap = z.object({
  status: z.literal("PASS"),
  origin: z.literal(STAGING_BROWSER_ORIGIN),
  username: z.literal("ir35"),
  password: z.string().regex(/^[a-f0-9]{48}$/),
  mockOnly: z.literal(true),
  realAcceptance: z.literal(false),
  readOnly: z.literal(true),
  smtpSink: z.literal(true),
}).strict();

const requestBoundary = z.object({ method: z.string().max(8), url: z.string().max(4096) });
const pages = /^\/(?:jobs(?:\/[a-f0-9-]{36})?|tools\/(?:ir35-status|take-home)|account|dashboard|pricing|resources|research|profile|settings|saved|inbox|applications|automation|contact|privacy|terms|cookies|changelog|stories|blog(?:\/[a-z0-9-]+)?|contracts\/[a-z0-9-]+)?$/;
const data = /^\/(?:api\/(?:health|jobs\/search|jobs\/[a-f0-9-]{36})|supabase\/(?:auth\/v1\/(?:user|settings|\.well-known\/jwks\.json)|rest\/v1\/jobs))$/;
const assets = /^\/(?:_next\/(?:static|image)\/?.*|brand\/.*|images\/.*|logos\/.*|(?:favicon\.ico|icon\.png|apple-icon\.png|robots\.txt|sitemap\.xml|llms\.txt)|sitemap\/[a-z0-9_.-]+)$/;

/** No generic GET API permission: cron/recovery/verification GETs can mutate. */
export function allowStagingRead(input: unknown): boolean {
  const parsed = requestBoundary.safeParse(input);
  if (!parsed.success || parsed.data.method !== "GET" || parsed.data.url.includes("\\")) return false;
  try {
    const url = new URL(parsed.data.url);
    if (url.origin !== STAGING_BROWSER_ORIGIN || url.username || url.password || url.hash || url.pathname.includes("%")) return false;
    if ([...url.searchParams.keys()].some((key) => /(?:token|password|secret|api.?key|^code$|redirect|callback)/i.test(key))) return false;
    // Image optimisation may otherwise issue a server-side external request.
    if (url.pathname === "/_next/image") {
      const image = url.searchParams.get("url");
      if (!image || !image.startsWith("/") || image.startsWith("//") || image.includes("\\")) return false;
    }
    return pages.test(url.pathname) || data.test(url.pathname) || assets.test(url.pathname);
  } catch {
    return false;
  }
}

export function safeBrowserFailure(error: unknown) {
  // Never propagate Playwright/HTTP/Zod messages containing headers or input.
  const name = error instanceof Error ? error.name : "Unknown";
  return { status: "FAIL", code: "ProtectedReadonlyBrowserCheckFailed", errorType: ["Error", "TypeError", "TimeoutError", "SyntaxError"].includes(name) ? name : "Unknown" };
}

export function stagingReadHeaders(url: string, existing: Record<string, string>, basic: string): Record<string, string> {
  if (!allowStagingRead({ method: "GET", url }) || !/^[A-Za-z0-9+/]{1,124}={0,2}$/.test(basic)) throw new Error("FixedReadonlyHeaderBoundaryRequired");
  // SDK's gate cookie authenticates Caddy; its own Bearer header authenticates
  // GoTrue/PostgREST. Never replace that Bearer with the edge Basic credential.
  return new URL(url).pathname.startsWith("/supabase/") ? { ...existing } : { ...existing, authorization: "Basic " + basic };
}
