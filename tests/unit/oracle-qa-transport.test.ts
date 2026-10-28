import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { describe, expect, it, vi } from "vitest";
import { QA_ORIGIN, qaBrowserUrl, qaRedirectAllowed, qaTunnelRequest, type QaRequester } from "../../scripts/oracle-qa-transport";

const tunnel = { host: "127.0.0.1", port: 19443, fixture: "webqa01" };
const credential = { username: "ir35", password: "a".repeat(48) }; // Synthetic, never an operator credential.
function wire(status = 200, location?: string) {
  let options: RequestOptions | undefined, ended: Buffer | undefined;
  const incoming = Object.assign(new EventEmitter(), { statusCode: status, headers: location ? { location } : {}, destroy: vi.fn() });
  const client = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn((body?: Buffer) => {
    ended = body; queueMicrotask(() => { if (!incoming.destroy.mock.calls.length) { incoming.emit("data", Buffer.from("actual-fixture-response")); incoming.emit("end"); } });
  }) });
  const requester: QaRequester = vi.fn((value, response) => {
    options = value; queueMicrotask(() => response(incoming as unknown as IncomingMessage));
    return client as unknown as ClientRequest;
  });
  return { requester, incoming, client, observed: () => ({ options, ended }) };
}

describe("private Oracle QA browser transport", () => {
  it("always dials only the loopback tunnel with real staging SNI and mandatory TLS verification", async () => {
    const fixture = wire();
    const reply = await qaTunnelRequest(QA_ORIGIN + "/jobs?q=fixture", { method: "GET" }, tunnel, credential, fixture.requester);
    expect(reply.status).toBe(200); expect(reply.body.toString()).toBe("actual-fixture-response");
    expect(fixture.observed().options).toMatchObject({ hostname: "127.0.0.1", port: 19443,
      servername: "staging.ir35careers.com", rejectUnauthorized: true, agent: false, path: "/jobs?q=fixture" });
    expect(fixture.requester).toHaveBeenCalledTimes(1);
  });
  it("preserves an app Bearer token while supplying Basic through the separate private-edge header", async () => {
    const fixture = wire(), body = Buffer.from('{"fixture":true}');
    await qaTunnelRequest(QA_ORIGIN + "/api/applications/submit", { method: "POST", body, headers: {
      authorization: "Bearer fixture-session-not-real", "x-staging-authorization": "malicious-override",
      host: "public.invalid", "x-forwarded-host": "public.invalid", referer: "https://public.invalid/token",
    } }, tunnel, credential, fixture.requester);
    const headers = fixture.observed().options!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer fixture-session-not-real");
    expect(headers["x-staging-authorization"]).toBe("Basic " + Buffer.from("ir35:" + credential.password).toString("base64"));
    expect(headers.host).toBe("staging.ir35careers.com"); expect(headers.origin).toBe(QA_ORIGIN);
    expect(headers.referer).toBe(QA_ORIGIN + "/"); expect(headers["x-forwarded-host"]).toBeUndefined();
    expect(headers["accept-encoding"]).toBe("identity");
    expect(fixture.observed().ended).toEqual(body);
  });
  it("never injects edge Basic into the SDK's Bearer/apikey/cookie authentication", async () => {
    const fixture = wire();
    await qaTunnelRequest(QA_ORIGIN + "/supabase/auth/v1/user", { method: "GET", headers: {
      authorization: "Bearer fixture-session", apikey: "fixture-public-anon", cookie: "__Host-ir35-staging=fixture-gate",
    } }, tunnel, credential, fixture.requester);
    const headers = fixture.observed().options!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer fixture-session"); expect(headers.apikey).toBe("fixture-public-anon");
    expect(headers.cookie).toBe("__Host-ir35-staging=fixture-gate"); expect(headers["x-staging-authorization"]).toBeUndefined();
  });
  it.each([
    ["https://www.ir35careers.com/jobs", "GET"], ["https://api-staging.ir35careers.com/auth/v1/user", "GET"],
    ["https://staging.ir35careers.com:9443/jobs", "GET"], [QA_ORIGIN + "/api/pipeline/fetch", "GET"],
    [QA_ORIGIN + "/api/integrations/email/send", "POST"], [QA_ORIGIN + "/api/queues/applications", "POST"],
    [QA_ORIGIN + "/api/applications/worker/claim", "POST"], [QA_ORIGIN + "/api/billing/checkout", "POST"],
    [QA_ORIGIN + "/supabase/auth/v1/authorize?provider=google", "GET"],
    [QA_ORIGIN + "/supabase/rest/v1/rpc/add_to_waitlist", "POST"],
    [QA_ORIGIN + "/_next/image?url=https%3A%2F%2Femployer.invalid%2Flogo", "GET"],
    [QA_ORIGIN + "/_next/image?url=%2Fapi%2Fpipeline%2Ffetch", "GET"],
    [QA_ORIGIN + "/_next/image?url=%2F%252F%252Femployer.invalid", "GET"],
    [QA_ORIGIN + "/_next/image?url=%2F_next%2Fimage", "GET"],
    [QA_ORIGIN + "/jobs#fixture-token", "GET"], ["https://user:fixture@staging.ir35careers.com/jobs", "GET"],
  ])("rejects a provider/action/foreign target before a request %#", async (url, method) => {
    const fixture = wire();
    expect(qaBrowserUrl(url, method)).toBeNull();
    await expect(qaTunnelRequest(url, { method }, tunnel, credential, fixture.requester)).rejects.toThrow("BoundaryRejected");
    expect(fixture.requester).not.toHaveBeenCalled();
  });
  it("lets actual negative RLS requests reach the owned server, rather than synthesizing their denial", () => {
    expect(qaBrowserUrl(QA_ORIGIN + "/supabase/rest/v1/application_packets?id=eq.fixture", "PATCH")).not.toBeNull();
    expect(qaBrowserUrl(QA_ORIGIN + "/supabase/rest/v1/rpc/save_application_draft", "POST")).not.toBeNull();
  });
  it("allows same-origin redirects without following them, and rejects external/unsafe redirects", async () => {
    const same = wire(303, "/dashboard");
    expect((await qaTunnelRequest(QA_ORIGIN + "/auth/callback?token_hash=fixture", { method: "GET" }, tunnel, credential, same.requester)).status).toBe(303);
    expect(same.requester).toHaveBeenCalledTimes(1);
    expect(qaRedirectAllowed("/auth/callback#access_token=fixture-not-real", new URL(QA_ORIGIN))).toBe(true);
    expect(qaRedirectAllowed("https://employer.invalid/#access_token=fixture-not-real", new URL(QA_ORIGIN))).toBe(false);
    expect(qaRedirectAllowed("/jobs#access_token=fixture-not-real", new URL(QA_ORIGIN))).toBe(false);
    for (const location of ["https://employer.invalid/", "//production.invalid/", "http://staging.ir35careers.com/dashboard", "/api/pipeline/fetch"]) {
      const fixture = wire(302, location);
      expect(qaRedirectAllowed(location, new URL(QA_ORIGIN))).toBe(false);
      await expect(qaTunnelRequest(QA_ORIGIN + "/account", { method: "GET" }, tunnel, credential, fixture.requester)).rejects.toThrow("QaExternalRedirectRejected");
      expect(fixture.requester).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects a remote tunnel, invalid credentials, header injection and oversized bodies without network", async () => {
    const fixture = wire();
    for (const bad of [{ ...tunnel, host: "132.145.28.134" }, { ...tunnel, port: 443 }, { ...tunnel, fixture: "other" }])
      await expect(qaTunnelRequest(QA_ORIGIN + "/jobs", { method: "GET" }, bad, credential, fixture.requester)).rejects.toThrow("BoundaryRejected");
    await expect(qaTunnelRequest(QA_ORIGIN + "/jobs", { method: "GET" }, tunnel, { ...credential, password: "fixture-private-sentinel" }, fixture.requester)).rejects.toThrow("BoundaryRejected");
    await expect(qaTunnelRequest(QA_ORIGIN + "/jobs", { method: "GET", headers: { cookie: "fixture\r\nInjected: x" } }, tunnel, credential, fixture.requester)).rejects.toThrow("QaHeaderBoundaryRejected");
    await expect(qaTunnelRequest(QA_ORIGIN + "/api/applications/submit", { method: "POST", body: Buffer.alloc(2_097_153) }, tunnel, credential, fixture.requester)).rejects.toThrow("BoundaryRejected");
    expect(fixture.requester).not.toHaveBeenCalled();
  });
  it("withholds raw network errors and never retries", async () => {
    const client = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
    const requester: QaRequester = vi.fn(() => {
      queueMicrotask(() => client.emit("error", new Error("fixture-private-sentinel https://private.invalid")));
      return client as unknown as ClientRequest;
    });
    const error = await qaTunnelRequest(QA_ORIGIN + "/jobs", { method: "GET" }, tunnel, credential, requester).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe("QaTunnelRequestFailed_RawWithheld");
    expect(requester).toHaveBeenCalledTimes(1);
  });
  it.each(["overflow", "malformed-chunk", "closed-before-end"])("bounds an incomplete or malformed response without logging it: %s", async failure => {
    const incoming = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, destroy: vi.fn() });
    const client = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
    const requester: QaRequester = vi.fn((_options, response) => {
      queueMicrotask(() => {
        response(incoming as unknown as IncomingMessage);
        if (failure === "closed-before-end") incoming.emit("close");
        else incoming.emit("data", failure === "overflow" ? Buffer.alloc(16_777_217) : "fixture-malformed-chunk");
      });
      return client as unknown as ClientRequest;
    });
    await expect(qaTunnelRequest(QA_ORIGIN + "/jobs", { method: "GET" }, tunnel, credential, requester)).rejects.toThrow(/^QaTunnelResponse/);
    expect(requester).toHaveBeenCalledTimes(1);
  });
});
