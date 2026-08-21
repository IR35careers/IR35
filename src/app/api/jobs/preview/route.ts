import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { parseExternalJobHtml } from "@/lib/job-preview";
import { validatePublicHttpsUrl } from "@/lib/security/public-url";
import { getPinnedPublicHttps } from "@/lib/security/pinned-https";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { consumePublicRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
const MAX_BYTES = 1_000_000;
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

async function fetchPublicHtml(initial: URL): Promise<{ html: string; finalUrl: string }> {
  let current = initial;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await getPinnedPublicHttps(current.toString(), {
      maxBytes: MAX_BYTES,
      timeoutMs: 8_000,
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "IR35Careers-JobPreview/1.0 (+https://www.ir35careers.com/job-listing-policy)" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
      if (!location || redirect === 3) throw new Error("The source redirected too many times.");
      current = await validatePublicHttpsUrl(new URL(location, current).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`The source returned HTTP ${response.status}.`);
    const rawContentType = response.headers["content-type"];
    const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType)?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("The URL is not an HTML job page.");
    return { html: response.body.toString("utf8"), finalUrl: current.toString() };
  }
  throw new Error("The source page could not be loaded.");
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export async function POST(request: Request) {
  const rate = await consumePublicRateLimit(request, "job_preview", 12, 10 * 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  try {
    const body = await readJsonBody<{ url?: unknown }>(request, 4_000);
    if (typeof body.url !== "string" || !body.url.trim()) throw new Error("Enter a public job URL.");
    const url = await validatePublicHttpsUrl(body.url.trim());
    const source = await fetchPublicHtml(url);
    const job = parseExternalJobHtml(source.html, source.finalUrl, stableUuid(source.finalUrl));
    return NextResponse.json({ job }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The job page could not be analysed.";
    return NextResponse.json({ error: message }, { status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE });
  }
}
