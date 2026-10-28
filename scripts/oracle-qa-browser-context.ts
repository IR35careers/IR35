/** Real browser traffic through the private fixture. No mocked responses,
 * storage-state files, session logging, screenshots, tracing or TLS bypass.
 * This module does not launch a browser/SSH connection or run a native gate.
 */
import type { Browser, BrowserContext, Route, WebSocketRoute } from "playwright-core";
import { qaBrowserHeaders, qaBrowserUrl } from "./oracle-qa-transport";
import { startQaProxy } from "./oracle-qa-proxy";

export function qaRealtimeUrl(input: string): boolean {
  if (typeof input !== "string" || input.length > 4096 || /[\\\r\n\0]/.test(input)) return false;
  try {
    const url = new URL(input);
    return url.origin === "wss://staging.ir35careers.com" && !url.username && !url.password && !url.hash
      && url.pathname === "/supabase/realtime/v1/websocket"
      && [...url.searchParams.keys()].every(key => ["apikey", "vsn", "log_level"].includes(key))
      && url.searchParams.getAll("apikey").length === 1 && Boolean(url.searchParams.get("apikey"))
      && url.searchParams.getAll("vsn").length === 1 && url.searchParams.get("vsn") === "1.0.0"
      && url.searchParams.getAll("log_level").length <= 1
      && (!url.searchParams.has("log_level") || url.searchParams.get("log_level") === "error");
  } catch { return false; }
}

export type QaBrowserCounts = { requests: number; writeRequests: number; blockedRequests: number; webSockets: number; blockedWebSockets: number; transportErrors: number };

/** Caller must launch normal headed Chromium and attest the SSH destination,
 * owned fixture, pinned images and baseline before calling. No retries. All
 * secret-bearing headers/URLs remain RAM-only; metrics contain counts only.
 */
export async function createQaContext(browser: Browser, tunnel: unknown, credentials: unknown): Promise<{
  context: BrowserContext; counts: () => QaBrowserCounts; close: () => Promise<void>;
}> {
  const proxy = await startQaProxy(tunnel);
  let context: BrowserContext | undefined;
  const counters: QaBrowserCounts = { requests: 0, writeRequests: 0, blockedRequests: 0, webSockets: 0, blockedWebSockets: 0, transportErrors: 0 };
  try {
    context = await browser.newContext({ proxy: { server: proxy.server }, serviceWorkers: "block",
      ignoreHTTPSErrors: false, acceptDownloads: false, locale: "en-GB", viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", async (route: Route) => {
      const request = route.request(), method = request.method();
      if (!qaBrowserUrl(request.url(), method) || (request.postDataBuffer()?.length ?? 0) > 2_097_152) {
        counters.blockedRequests++; await route.abort("blockedbyclient"); return;
      }
      try {
        const headers = qaBrowserHeaders(request.url(), method, await request.allHeaders(), credentials);
        counters.requests++; if (!["GET", "HEAD"].includes(method)) counters.writeRequests++;
        await route.continue({ headers });
      } catch { counters.transportErrors++; await route.abort("blockedbyclient").catch(() => undefined); }
    });
    await context.routeWebSocket(/.*/, (route: WebSocketRoute) => {
      if (!qaRealtimeUrl(route.url())) { counters.blockedWebSockets++; void route.close({ code: 1008, reason: "Fixture route only" }); return; }
      counters.webSockets++;
      // Native server connection with native browser cookies/TLS and no message
      // handlers: Playwright forwards actual frames both ways automatically.
      // The CONNECT relay admits only the private forwarded staging origin.
      route.connectToServer();
    });
    const owned = context;
    let closePromise: Promise<void> | undefined;
    return { context: owned, counts: () => ({ ...counters }), close: () => {
      closePromise ??= (async () => {
        try { await owned.close(); } finally { await proxy.close(); }
        if (proxy.counters().active !== 0) throw new Error("QaBrowserTunnelStillConnected");
      })();
      return closePromise;
    } };
  } catch {
    try { await context?.close(); } finally { await proxy.close(); }
    throw new Error("QaBrowserContextFailed_RawWithheld");
  }
}
