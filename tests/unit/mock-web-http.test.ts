import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_WEB_CLAIM_PATH, MOCK_WEB_CALLBACK_PATH, mockWebSignature, verifyMockWebSignature, mockWebInternalPost } from "@/lib/queue/mock-web-http";

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup }));
afterEach(() => vi.clearAllMocks());
const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const env = { IR35_MOCK_WEB_ENABLED: "true", IR35_STAGING: "true", APPLY_RUNNER: "mock", IR35_SCHEDULER_ENABLED: "false",
  APPLICATION_WORKER_ACCEPT_JOBS: "false", IR35_READ_ONLY: "false", APPLICATION_WORKER_CONCURRENCY: "1",
  APPLICATION_WORKER_SECRET: "fixture-only-not-a-real-secret-0000000", IR35CAREERS_APP_URL: "https://staging.ir35careers.com",
  IR35_MOCK_WEB_JOB_IDS: ids.join(",") };
const payload = { kind: "staging_web_mock_claim", applicationId: ids[0], jobId: ids[1], deliveryVersion: 1,
  workerId: `staging-web-mock-${ids[2]}` };

async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void,
  action: (url: string) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await action(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

describe("private signed mock app transport", () => {
  it("binds signatures to purpose, method, exact path, timestamp and exact body", () => {
    const body = JSON.stringify(payload), timestamp = "1793100000000";
    const signature = mockWebSignature(env.APPLICATION_WORKER_SECRET, timestamp, "POST", MOCK_WEB_CLAIM_PATH, body);
    const input = { secret: env.APPLICATION_WORKER_SECRET, timestamp, signature, method: "POST", path: MOCK_WEB_CLAIM_PATH, body, now: Number(timestamp) };
    expect(verifyMockWebSignature(input)).toBe(true);
    for (const extra of [{ method: "GET" }, { path: MOCK_WEB_CALLBACK_PATH }, { path: "/api/admin" },
      { body: body + " " }, { now: Number(timestamp) + 30_001 }, { timestamp: "invalid" }, { signature: "x" }])
      expect(verifyMockWebSignature({ ...input, ...extra })).toBe(false);
  });
  it("uses actual loopback HTTP with no auth key/Basic/Bearer or personal data in the payload", async () => {
    let observed = false;
    await fixture((request, response) => {
      let body = ""; request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        observed = true;
        expect(request.url).toBe(MOCK_WEB_CLAIM_PATH);
        expect(JSON.parse(body)).toEqual(payload);
        expect(request.headers.authorization).toBeUndefined();
        expect(JSON.stringify(request.headers)).not.toContain(env.APPLICATION_WORKER_SECRET);
        expect(verifyMockWebSignature({ secret: env.APPLICATION_WORKER_SECRET,
          timestamp: request.headers["x-ir35-web-mock-timestamp"], signature: request.headers["x-ir35-web-mock-signature"],
          method: request.method!, path: request.url!, body })).toBe(true);
        response.writeHead(200).end('{"ok":true}');
      });
    }, async url => {
      await expect(mockWebInternalPost(MOCK_WEB_CLAIM_PATH, payload, { ...env,
        IR35_MOCK_WEB_INTERNAL_URL: url, IR35_MOCK_WEB_INTERNAL_HOST: "127.0.0.1" })).resolves.toEqual({ ok: true });
    });
    expect(observed).toBe(true); expect(dns.lookup).not.toHaveBeenCalled();
  });
  it("pins a single all-private DNS answer without asking HTTP to resolve again", async () => {
    dns.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await fixture((request, response) => { expect(request.headers.host).toMatch(/^p8-app:/); response.end('{"ok":true}'); }, async url => {
      await expect(mockWebInternalPost(MOCK_WEB_CLAIM_PATH, payload, { ...env,
        IR35_MOCK_WEB_INTERNAL_URL: url.replace("127.0.0.1", "p8-app"), IR35_MOCK_WEB_INTERNAL_HOST: "p8-app" })).resolves.toEqual({ ok: true });
    });
    expect(dns.lookup).toHaveBeenCalledExactlyOnceWith("p8-app", { all: true, verbatim: true });
  });
  it("rejects mixed/private-public DNS before a request", async () => {
    dns.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }, { address: "203.0.113.10", family: 4 }]);
    await expect(mockWebInternalPost(MOCK_WEB_CLAIM_PATH, payload, { ...env,
      IR35_MOCK_WEB_INTERNAL_URL: "http://p8-app:3000", IR35_MOCK_WEB_INTERNAL_HOST: "p8-app" })).rejects.toThrow("isolated mock control plane is unavailable");
    expect(dns.lookup).toHaveBeenCalledTimes(1);
  });
  it("uses the explicit staging vhost while retaining the SAME private DNS/IP pin", async () => {
    dns.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await fixture((request, response) => {
      expect(request.headers.host).toBe("staging.ir35careers.com");
      expect(request.headers["x-forwarded-host"]).toBeUndefined();
      expect(request.headers.authorization).toBeUndefined();
      response.end('{"ok":true}');
    }, async url => {
      await expect(mockWebInternalPost(MOCK_WEB_CLAIM_PATH, payload, { ...env,
        IR35_MOCK_WEB_INTERNAL_URL: url.replace("127.0.0.1", "p8-app"), IR35_MOCK_WEB_INTERNAL_HOST: "p8-app",
        IR35_MOCK_WEB_INTERNAL_VHOST: "staging.ir35careers.com" })).resolves.toEqual({ ok: true });
    });
    expect(dns.lookup).toHaveBeenCalledExactlyOnceWith("p8-app", { all: true, verbatim: true });
  });
  it.each(["www.ir35careers.com", "admin.ir35careers.com", "staging.ir35careers.com:3000",
    "staging.ir35careers.com\n", "*", "private-fixture.invalid"])("rejects any unapproved virtual host before DNS: %s", async value => {
    await expect(mockWebInternalPost(MOCK_WEB_CLAIM_PATH, payload, { ...env,
      IR35_MOCK_WEB_INTERNAL_URL: "http://p8-app:3000", IR35_MOCK_WEB_INTERNAL_HOST: "p8-app",
      IR35_MOCK_WEB_INTERNAL_VHOST: value })).rejects.toThrow("isolated mock control plane is unavailable");
    expect(dns.lookup).not.toHaveBeenCalled();
  });
  it.each(["203.0.113.10", "169.254.169.254", "0.0.0.0", "[::ffff:127.0.0.1]"])("rejects unsafe numeric targets %s", async host => {
    await expect(mockWebInternalPost(MOCK_WEB_CLAIM_PATH, payload, { ...env,
      IR35_MOCK_WEB_INTERNAL_URL: `http://${host}:3000`, IR35_MOCK_WEB_INTERNAL_HOST: host.replace(/^\[|\]$/g, "") })).rejects.toThrow("no submission is confirmed");
    expect(dns.lookup).not.toHaveBeenCalled();
  });
  it("rejects wrong paths, URLs, host allowlist, write gate and PII before the network", async () => {
    const base = { ...env, IR35_MOCK_WEB_INTERNAL_URL: "http://p8-app:3000", IR35_MOCK_WEB_INTERNAL_HOST: "p8-app" };
    for (const extra of [{ IR35_MOCK_WEB_INTERNAL_URL: "https://p8-app:3000" }, { IR35_MOCK_WEB_INTERNAL_HOST: "*" },
      { IR35_MOCK_WEB_INTERNAL_HOST: "other" }, { IR35_READ_ONLY: "true" },
      { IR35_MOCK_WEB_INTERNAL_URL: "http://u:fixture-private-sentinel@p8-app:3000" },
      { IR35_MOCK_WEB_INTERNAL_URL: "http://p8-app:3000\nfixture-private-sentinel" }]) {
      const reply = mockWebInternalPost(MOCK_WEB_CLAIM_PATH, payload, { ...base, ...extra });
      await expect(reply).rejects.not.toThrow("fixture-private-sentinel");
    }
    await expect(mockWebInternalPost("/api/admin", payload, base)).rejects.toThrow();
    await expect(mockWebInternalPost(MOCK_WEB_CLAIM_PATH, { ...payload, password: "fixture-private-sentinel" }, base)).rejects.toThrow();
    expect(dns.lookup).not.toHaveBeenCalled();
  });
  it("never follows redirects even to another owned loopback fixture", async () => {
    let redirected = 0;
    await fixture((request, response) => { redirected++; response.end('{}'); }, async destination => {
      await fixture((request, response) => { response.writeHead(307, { location: destination }).end(); }, async url => {
        await expect(mockWebInternalPost(MOCK_WEB_CLAIM_PATH, payload, { ...env,
          IR35_MOCK_WEB_INTERNAL_URL: url, IR35_MOCK_WEB_INTERNAL_HOST: "127.0.0.1" })).rejects.toThrow("no submission is confirmed");
      });
    });
    expect(redirected).toBe(0);
  });
  it.each(["fixture-private-sentinel", "x".repeat(16_385)])("bounds and redacts malformed or oversized responses %#", async body => {
    await fixture((request, response) => { response.end(body); }, async url => {
      await expect(mockWebInternalPost(MOCK_WEB_CLAIM_PATH, payload, { ...env,
        IR35_MOCK_WEB_INTERNAL_URL: url, IR35_MOCK_WEB_INTERNAL_HOST: "127.0.0.1" })).rejects.not.toThrow("fixture-private-sentinel");
    });
  });
});
