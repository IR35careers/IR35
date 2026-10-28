import type { Browser, Route, WebSocketRoute } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { createQaContext, qaRealtimeUrl } from "../../scripts/oracle-qa-browser-context";

const credentials = { username: "ir35", password: "a".repeat(48) };
const tunnel = { host: "127.0.0.1", port: 19443, fixture: "webqa01" };
function browserFixture() {
  let http: (route: Route) => Promise<void>, websocket: (route: WebSocketRoute) => void;
  const context = { route: vi.fn(async (_pattern, handler) => { http = handler; }),
    routeWebSocket: vi.fn(async (_pattern, handler) => { websocket = handler; }), close: vi.fn(async () => {}) };
  const newContext = vi.fn<(options: Record<string, unknown>) => Promise<typeof context>>().mockResolvedValue(context);
  return { browser: { newContext } as unknown as Browser, context, newContext,
    http: (route: unknown) => http(route as Route), websocket: (route: unknown) => websocket(route as WebSocketRoute) };
}
function routeFixture(url: string, method = "GET", headers: Record<string, string> = {}) {
  return { request: () => ({ url: () => url, method: () => method, postDataBuffer: () => null, allHeaders: async () => headers }),
    abort: vi.fn(async () => {}), continue: vi.fn(async () => {}) };
}

describe("owned browser context leaves Auth and Realtime responses real", () => {
  it("uses the local relay, genuine certificate verification, fresh memory-only context and blocked service workers", async () => {
    const fixture = browserFixture(), qa = await createQaContext(fixture.browser, tunnel, credentials);
    try {
      expect(fixture.newContext).toHaveBeenCalledWith(expect.objectContaining({ proxy: { server: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) },
        ignoreHTTPSErrors: false, serviceWorkers: "block", acceptDownloads: false, locale: "en-GB" }));
      const options = fixture.newContext.mock.calls[0]![0];
      for (const key of ["storageState", "recordVideo", "httpCredentials", "extraHTTPHeaders"]) expect(options).not.toHaveProperty(key);
    } finally { await qa.close(); }
    expect(fixture.context.close).toHaveBeenCalledTimes(1);
  });
  it("continues actual app traffic with its Bearer and separate edge Basic, never fulfills an Auth/application response", async () => {
    const fixture = browserFixture(), qa = await createQaContext(fixture.browser, tunnel, credentials);
    try {
      const route = routeFixture("https://staging.ir35careers.com/api/applications/submit", "POST", { authorization: "Bearer fixture-only" });
      await fixture.http(route);
      expect(route.continue).toHaveBeenCalledWith({ headers: expect.objectContaining({ authorization: "Bearer fixture-only", "x-staging-authorization": expect.stringMatching(/^Basic /) }) });
      expect(route.abort).not.toHaveBeenCalled(); expect(qa.counts().writeRequests).toBe(1);
    } finally { await qa.close(); }
  });
  it("blocks external/provider/action requests without ever forwarding their headers or bodies", async () => {
    const fixture = browserFixture(), qa = await createQaContext(fixture.browser, tunnel, credentials);
    try {
      for (const url of ["https://employer.invalid/submit", "https://accounts.google.com/", "https://staging.ir35careers.com/api/cron/test"]) {
        const route = routeFixture(url, "POST"); await fixture.http(route);
        expect(route.continue).not.toHaveBeenCalled(); expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
      }
      expect(qa.counts()).toMatchObject({ blockedRequests: 3, requests: 0, writeRequests: 0 });
    } finally { await qa.close(); }
  });
  it("connects allowed Realtime to the actual server without replacing or inspecting messages", async () => {
    const fixture = browserFixture(), qa = await createQaContext(fixture.browser, tunnel, credentials);
    try {
      const route = { url: () => "wss://staging.ir35careers.com/supabase/realtime/v1/websocket?apikey=fixture-public&vsn=1.0.0", connectToServer: vi.fn(), close: vi.fn() };
      fixture.websocket(route); expect(route.connectToServer).toHaveBeenCalledTimes(1); expect(route.close).not.toHaveBeenCalled();
      const foreign = { ...route, url: () => "wss://employer.invalid/ws", connectToServer: vi.fn(), close: vi.fn() };
      fixture.websocket(foreign); expect(foreign.connectToServer).not.toHaveBeenCalled(); expect(foreign.close).toHaveBeenCalledWith({ code: 1008, reason: "Fixture route only" });
      expect(qa.counts()).toMatchObject({ webSockets: 1, blockedWebSockets: 1 });
    } finally { await qa.close(); }
  });
  it.each(["wss://www.ir35careers.com/supabase/realtime/v1/websocket?apikey=fixture&vsn=1.0.0",
    "wss://staging.ir35careers.com:8443/supabase/realtime/v1/websocket?apikey=fixture&vsn=1.0.0",
    "wss://staging.ir35careers.com/supabase/realtime/v1/websocket?apikey=fixture&vsn=1.0.0&other=1",
    "wss://staging.ir35careers.com/supabase/realtime/v1/websocket?apikey=fixture&apikey=other&vsn=1.0.0",
    "wss://staging.ir35careers.com/supabase/realtime/v1/websocket?apikey=fixture&vsn=1.0.0&log_level=info",
    "wss://user:fake@staging.ir35careers.com/supabase/realtime/v1/websocket?apikey=fixture&vsn=1.0.0",
    "wss://staging.ir35careers.com/supabase/realtime/v1/websocket?apikey=fixture&vsn=1.0.0#fragment"])("refuses an unsafe Realtime target %#", url => {
    expect(qaRealtimeUrl(url)).toBe(false);
  });
});
