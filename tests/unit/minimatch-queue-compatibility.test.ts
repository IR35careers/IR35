import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueueClient } from "@vercel/queue";

const routeMappings = Symbol.for("@vercel/queue.devRouteMappings");
const handlerRegistry = Symbol.for("@vercel/queue.devHandlerRegistry");
const globals = globalThis as unknown as Record<symbol, unknown>;
let previousMappings: PropertyDescriptor | undefined;
let previousRegistry: PropertyDescriptor | undefined;

function restoreProperty(key: symbol, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  else delete globals[key];
}

function client() {
  return new QueueClient({
    region: "iad1",
    token: "synthetic-unit-token-not-a-credential",
    deploymentId: null,
    resolveBaseUrl: () => new URL("https://queue.invalid"),
  });
}

beforeEach(() => {
  previousMappings = Object.getOwnPropertyDescriptor(globalThis, routeMappings);
  previousRegistry = Object.getOwnPropertyDescriptor(globalThis, handlerRegistry);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_DEPLOYMENT_ID", undefined);
  vi.stubEnv("VERCEL_QUEUE_DEBUG", "0");
  vi.stubEnv("VERCEL_CLI_VERSION", undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real network is permitted in Queue compatibility tests"); }));
});

afterEach(() => {
  restoreProperty(routeMappings, previousMappings);
  restoreProperty(handlerRegistry, previousRegistry);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("patched minimatch with the actual Vercel Queue SDK", () => {
  it("resolves the Queue consumer to the patched package without changing unaffected 3.x consumers", () => {
    const require = createRequire(import.meta.url);
    const fromQueue = createRequire(require.resolve("@vercel/queue"));
    const metadata = JSON.parse(readFileSync(fromQueue.resolve("minimatch/package.json"), "utf8")) as { version: string };
    const [major, minor, patch] = metadata.version.split(".").map(Number);
    expect(major > 11 || (major === 11 && (minor > 0 || patch >= 1))).toBe(true);
    const minimatch = fromQueue("minimatch") as { minimatch: (value: string, pattern: string) => boolean };
    expect(minimatch.minimatch("src/app/api/queues/applications/route.ts", "src/app/api/queues/**/route.ts")).toBe(true);
    expect(minimatch.minimatch("src/app/api/health/route.ts", "src/app/api/queues/**/route.ts")).toBe(false);
  });

  it("preserves opaque publication data and delivery options with one mocked request", async () => {
    const payload = { applicationId: "11111111-1111-4111-8111-111111111111", kickId: "22222222-2222-4222-8222-222222222222" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://queue.invalid");
      expect(url.pathname).toBe("/api/v3/topic/mock-application-kicks");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("vqs-idempotency-key")).toBe(payload.kickId);
      expect(headers.get("vqs-retention-seconds")).toBe("604800");
      expect(headers.get("vqs-delay-seconds")).toBe("120");
      expect(headers.get("authorization")).toBe("Bearer synthetic-unit-token-not-a-credential");
      expect(init?.body).toBeInstanceOf(Uint8Array);
      if (!(init?.body instanceof Uint8Array)) throw new Error("Expected the JSON transport's encoded bytes");
      expect(JSON.parse(Buffer.from(init.body).toString("utf8"))).toEqual(payload);
      return Response.json({ messageId: "mock-message" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().send("mock-application-kicks", payload, {
      idempotencyKey: payload.kickId, retentionSeconds: 604800, delaySeconds: 120,
    })).resolves.toMatchObject({ messageId: "mock-message" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runs a synthetic callback once and acknowledges only its mock receipt", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://queue.invalid");
      expect(url.pathname).toBe("/api/v3/topic/mock-application-kicks/consumer/mock-consumer/lease/mock-receipt");
      expect(init?.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const handler = vi.fn(async () => undefined);
    const callback = client().handleCallback(handler);
    const payload = { applicationId: "11111111-1111-4111-8111-111111111111" };
    const response = await callback(new Request("https://queue.invalid/mock-callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "ce-type": "com.vercel.queue.v2beta",
        "ce-vqsqueuename": "mock-application-kicks",
        "ce-vqsconsumergroup": "mock-consumer",
        "ce-vqsmessageid": "mock-message",
        "ce-vqsreceipthandle": "mock-receipt",
      },
      body: JSON.stringify(payload),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "success" });
    expect(handler).toHaveBeenCalledExactlyOnceWith(payload, expect.objectContaining({
      messageId: "mock-message", topicName: "mock-application-kicks", consumerGroup: "mock-consumer",
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed callback before a handler or transport request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = vi.fn();
    const response = await client().handleCallback(handler)(new Request("https://queue.invalid/mock-callback", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["src/app/api/queues/applications/route.ts", true],
    ["src/app/api/health/route.ts", false],
  ])("preserves SDK glob-route registration for %s", async (file, matches) => {
    vi.stubEnv("NODE_ENV", "development");
    // Synthetic SDK configuration cache only: the actual SDK executes its own
    // matcher. No network, app database, route handler or matcher is substituted.
    Object.defineProperty(globalThis, routeMappings, { configurable: true, value: [{
      filePath: "src/app/api/queues/**/route.ts", topic: "mock-topic", consumer: "mock-consumer",
    }] });
    Object.defineProperty(globalThis, handlerRegistry, { configurable: true, value: new Map() });
    const handler = vi.fn();
    const callback = client().handleCallback(handler);
    const response = await callback(new Request("https://queue.invalid/mock-callback", {
      method: "POST", headers: { "x-vercel-queue-prime": "1", "x-vercel-queue-prime-file": file },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "primed" });
    const registry = globals[handlerRegistry] as Map<string, { handler: unknown; consumerGroup: string }[]>;
    expect(registry.has("mock-topic")).toBe(matches);
    if (matches) expect(registry.get("mock-topic")).toEqual([expect.objectContaining({ handler, consumerGroup: "mock-consumer" })]);
    expect(handler).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
