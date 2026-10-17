import chromiumBinary from "@sparticuz/chromium";
import { chromium } from "playwright-core";
import { ApplicationWorkerRequestError, readSignedApplicationWorkerJson } from "@/lib/application-worker-request";
import { publicRequestGuard } from "@/lib/application-runner/run";
import { validatePublicHttpsUrl } from "@/lib/security/public-url";

export const runtime = "nodejs";
export const maxDuration = 60;
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Read-only hosted-browser diagnostic. Never fills fields or permits POST. */
export async function POST(request: Request) {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const input = await readSignedApplicationWorkerJson(request, 4_000) as { action?: unknown; url?: unknown };
    if (input.action !== "inspect_employer_portal" || typeof input.url !== "string") return Response.json({ error: "Invalid portal probe." }, { status: 400, headers: HEADERS });
    const destination = await validatePublicHttpsUrl(input.url);
    browser = await chromium.launch({ executablePath: await chromiumBinary.executablePath(), args: chromiumBinary.args, headless: true });
    const context = await browser.newContext({ locale: "en-GB", timezoneId: "Europe/London", viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    const approvedHosts = new Set([destination.hostname]);
    await context.route("**/*", async (route) => {
      if (!["GET", "HEAD"].includes(route.request().method())) return route.abort();
      await publicRequestGuard(route, approvedHosts, () => false);
    });
    const page = await context.newPage();
    const navigation = await page.goto(destination.toString(), { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(1_000);
    const detail = await page.evaluate(() => ({
      title: document.title,
      path: location.pathname,
      hasQuery: Boolean(location.search),
      headings: Array.from(document.querySelectorAll("h1,h2,h3")).slice(0, 12).map((node) => node.textContent?.trim().slice(0, 180)),
      forms: Array.from(document.forms).slice(0, 12).map((form) => ({
        actionPath: new URL(form.action, location.href).pathname,
        method: form.method,
        controls: Array.from(form.querySelectorAll("input,textarea,select,button")).slice(0, 30).map((node) => ({ name: node.getAttribute("name"), type: node.getAttribute("type"), label: node.getAttribute("aria-label") || (node as HTMLInputElement).labels?.[0]?.textContent?.trim().slice(0, 100), visible: Boolean(node.getClientRects().length) })),
      })),
    }));
    return Response.json({ ok: true, execution: "hosted_chromium", status: navigation?.status(), requestedPath: destination.pathname, ...detail }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ApplicationWorkerRequestError) return Response.json({ error: error.message }, { status: error.status, headers: HEADERS });
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "Portal probe failed." }, { status: 500, headers: HEADERS });
  } finally { await browser?.close().catch(() => undefined); }
}
