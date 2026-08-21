import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { parseExternalJobHtml } from "@/lib/job-preview";
import { validatePublicHttpsUrl } from "@/lib/security/public-url";

export const runtime = "nodejs";
const MAX_BYTES = 1_000_000;
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

async function readLimitedHtml(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new Error("The source page is too large to analyse safely.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("The source page is too large to analyse safely.");
    }
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

async function fetchPublicHtml(initial: URL): Promise<{ html: string; finalUrl: string }> {
  let current = initial;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": "IR35Careers-JobPreview/1.0 (+https://www.ir35careers.com/job-listing-policy)" },
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error("The source redirected too many times.");
      current = await validatePublicHttpsUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`The source returned HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("The URL is not an HTML job page.");
    return { html: await readLimitedHtml(response), finalUrl: current.toString() };
  }
  throw new Error("The source page could not be loaded.");
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 4_000) return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: NO_STORE });
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) throw new Error("Enter a public job URL.");
    const url = await validatePublicHttpsUrl(body.url.trim());
    const source = await fetchPublicHtml(url);
    const job = parseExternalJobHtml(source.html, source.finalUrl, stableUuid(source.finalUrl));
    return NextResponse.json({ job }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "The source took too long to respond." : error instanceof Error ? error.message : "The job page could not be analysed.";
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
  }
}
