import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { handleMaintenanceHttp, readMaintenanceCommand, signMaintenanceBody, TrackedWorkerHandlers, WorkerDatabaseObservation, WorkerMaintenance } from "../../services/application-worker/maintenance";

const secret = "controlled-maintenance-fixture-only-32";
const operationId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const now = 1_761_000_000_000;
const body = JSON.stringify({ action: "drain", operationId });
const signed = () => ({ secret, body, now, timestamp: String(now), signature: signMaintenanceBody(secret, body, String(now)) });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe("fresh versioned submitting observations", () => {
  it("fails closed until a successful read and expires readiness, including backward clocks", () => {
    const health = new WorkerDatabaseObservation();
    expect(health.snapshot(now)).toEqual({ databaseReady: false, submitting: null });
    health.commit(health.begin(), 0, now);
    expect(health.snapshot(now + 44_999)).toEqual({ databaseReady: true, submitting: 0 });
    expect(health.snapshot(now + 45_000)).toEqual({ databaseReady: false, submitting: null });
    expect(health.snapshot(now - 1)).toEqual({ databaseReady: false, submitting: null });
  });
  it("a superseded zero or failed old read cannot replace the latest observation", () => {
    const health = new WorkerDatabaseObservation(); const old = health.begin(); const fresh = health.begin();
    health.commit(fresh, 1, now); health.commit(old, 0, now + 1); health.fail(old);
    expect(health.snapshot(now + 1)).toEqual({ databaseReady: true, submitting: 1 });
    health.fail(fresh); expect(health.snapshot(now + 1).databaseReady).toBe(false);
  });
  it("a database error invalidates every inflight read, including a later stale success", () => {
    const health = new WorkerDatabaseObservation(); const inflight = health.begin();
    health.invalidate(); health.commit(inflight, 0, now);
    expect(health.snapshot(now)).toEqual({ databaseReady: false, submitting: null });
    health.commit(health.begin(), 0, now + 1);
    expect(health.snapshot(now + 1).databaseReady).toBe(true);
  });
});

describe("worker local maintenance authentication", () => {
  it("accepts only a fresh exact signed operation, domain-separated from application callbacks", () => {
    expect(readMaintenanceCommand(signed())).toEqual({ action: "drain", operationId });
    expect(readMaintenanceCommand({ ...signed(), signature: createHmac("sha256", secret).update(`${now}.${body}`).digest("base64url") })).toBeNull();
    expect(readMaintenanceCommand({ ...signed(), body: body.replace("drain", "resume") })).toBeNull();
    expect(readMaintenanceCommand({ ...signed(), now: now + 30_001 })).toBeNull();
    expect(readMaintenanceCommand({ ...signed(), now: now - 30_001 })).toBeNull();
  });
  it.each([
    { signature: "invalid" }, { timestamp: "NaN" }, { secret: "too short" }, { body: "[malformed" },
    { body: "x".repeat(513) }, { body: "😀".repeat(150) }, { extra: "not accepted" },
  ])("rejects bad/oversize input without revealing it: %j", change => {
    expect(readMaintenanceCommand({ ...signed(), ...change })).toBeNull();
  });
  it("rejects correctly signed but invalid commands and undocumented extra fields", () => {
    for (const value of [{ action: "enable", operationId }, { action: "drain", operationId: "bad" },
      { action: "drain", operationId, APPLICATION_WORKER_ACCEPT_JOBS: true }]) {
      const text = JSON.stringify(value);
      expect(readMaintenanceCommand({ ...signed(), body: text, signature: signMaintenanceBody(secret, text, String(now)) })).toBeNull();
    }
  });
});

describe("polling drain without acceptance changes or application cancellation", () => {
  it("an updated consumer starts paused until its operation's health gate and explicit resume", async () => {
    const startConsumers = vi.fn(async () => {}); const stopConsumers = vi.fn(async () => {});
    const maintenance = new WorkerMaintenance({ configuredToAccept: true, initialOperationId: operationId, startConsumers, stopConsumers });
    expect(maintenance.snapshot()).toEqual({ phase: "drained", safeToReplace: true, operationId });
    expect(startConsumers).not.toHaveBeenCalled(); expect(stopConsumers).not.toHaveBeenCalled();
    expect(() => maintenance.request({ action: "resume", operationId: otherId })).toThrow("conflict");
    maintenance.request({ action: "resume", operationId }); await maintenance.settled();
    expect(startConsumers).toHaveBeenCalledTimes(1); expect(maintenance.snapshot().phase).toBe("idle");
  });
  it("a paused updated standby never starts consumers after its health gate", async () => {
    const startConsumers = vi.fn(async () => {});
    const maintenance = new WorkerMaintenance({ configuredToAccept: false, initialOperationId: operationId, startConsumers, stopConsumers: async () => {} });
    maintenance.request({ action: "resume", operationId }); await maintenance.settled();
    expect(startConsumers).not.toHaveBeenCalled(); expect(maintenance.snapshot().phase).toBe("idle");
    expect(() => new WorkerMaintenance({ configuredToAccept: false, initialOperationId: "not-a-uuid", startConsumers, stopConsumers: async () => {} })).toThrow();
  });
  it("includes a callback that outlives pg-boss stop acknowledgement, including late fetches and background work", async () => {
    const callbacks = new TrackedWorkerHandlers(); const app = deferred(); const background = deferred(); const stopped = deferred();
    const maintenance = new WorkerMaintenance({ configuredToAccept: true,
      stopConsumers: async () => { await stopped.promise; await callbacks.whenIdle(); }, startConsumers: async () => {},
    });
    const running = callbacks.run(() => app.promise);
    maintenance.request({ action: "drain", operationId });
    const late = callbacks.run(() => background.promise);
    stopped.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(callbacks.count).toBe(2); expect(maintenance.snapshot().safeToReplace).toBe(false);
    app.resolve(); await running; expect(callbacks.count).toBe(1); expect(maintenance.snapshot().safeToReplace).toBe(false);
    background.resolve(); await late; await maintenance.settled();
    expect(callbacks.count).toBe(0); expect(maintenance.snapshot().safeToReplace).toBe(true);
    await expect(callbacks.run(async () => { throw new Error("controlled callback error"); })).rejects.toThrow("controlled callback error");
    await callbacks.whenIdle(); expect(callbacks.count).toBe(0);
  });
  it("waits for stop completion, not a momentary active counter, and deduplicates drain/resume", async () => {
    const stopped = deferred(); const started = deferred();
    const stopConsumers = vi.fn(() => stopped.promise); const startConsumers = vi.fn(() => started.promise);
    const maintenance = new WorkerMaintenance({ configuredToAccept: true, stopConsumers, startConsumers });
    expect(maintenance.request({ action: "drain", operationId })).toMatchObject({ phase: "draining", safeToReplace: false });
    maintenance.request({ action: "drain", operationId });
    await Promise.resolve(); expect(stopConsumers).toHaveBeenCalledTimes(1);
    expect(maintenance.snapshot().safeToReplace).toBe(false);
    stopped.resolve(); await maintenance.settled();
    expect(maintenance.snapshot()).toEqual({ phase: "drained", operationId, safeToReplace: true });
    maintenance.request({ action: "resume", operationId }); maintenance.request({ action: "resume", operationId });
    expect(startConsumers).toHaveBeenCalledTimes(1); expect(maintenance.snapshot().phase).toBe("resuming");
    started.resolve(); await maintenance.settled();
    expect(maintenance.snapshot()).toEqual({ phase: "idle", operationId: null, safeToReplace: false });
    maintenance.request({ action: "resume", operationId }); expect(startConsumers).toHaveBeenCalledTimes(1);
    expect(() => maintenance.request({ action: "drain", operationId })).toThrow("already finished");
  });
  it("an updater timeout can arm safe resume without re-registering while old handlers are still running", async () => {
    const stopped = deferred(); const startConsumers = vi.fn(async () => {});
    const maintenance = new WorkerMaintenance({ configuredToAccept: true, stopConsumers: () => stopped.promise, startConsumers });
    maintenance.request({ action: "drain", operationId }); await Promise.resolve();
    maintenance.request({ action: "resume", operationId });
    expect(maintenance.snapshot().phase).toBe("draining"); expect(startConsumers).not.toHaveBeenCalled();
    stopped.resolve(); await maintenance.settled();
    expect(startConsumers).toHaveBeenCalledTimes(1); expect(maintenance.snapshot().phase).toBe("idle");
  });
  it("standby drain/resume can never start any queue consumer", async () => {
    const stopConsumers = vi.fn(async () => {}); const startConsumers = vi.fn(async () => {});
    const maintenance = new WorkerMaintenance({ configuredToAccept: false, stopConsumers, startConsumers });
    maintenance.request({ action: "drain", operationId }); await maintenance.settled();
    expect(maintenance.snapshot().safeToReplace).toBe(true);
    maintenance.request({ action: "resume", operationId }); await maintenance.settled();
    expect(maintenance.snapshot().phase).toBe("idle");
    expect(startConsumers).not.toHaveBeenCalled(); expect(stopConsumers).not.toHaveBeenCalled();
  });
  it("conflicting/invalid requests and failed stops never enable a replacement or duplicate consumer", async () => {
    const startConsumers = vi.fn(async () => {});
    const maintenance = new WorkerMaintenance({ configuredToAccept: true, stopConsumers: async () => { throw new Error("controlled stop error"); }, startConsumers });
    expect(() => maintenance.request({ action: "enable", operationId })).toThrow("Invalid maintenance command");
    maintenance.request({ action: "drain", operationId });
    expect(() => maintenance.request({ action: "drain", operationId: otherId })).toThrow("conflict");
    expect(() => maintenance.request({ action: "resume", operationId: otherId })).toThrow("conflict");
    await maintenance.settled(); expect(maintenance.snapshot()).toMatchObject({ phase: "failed", safeToReplace: false });
    expect(() => maintenance.request({ action: "resume", operationId })).toThrow("conflict");
    expect(startConsumers).not.toHaveBeenCalled();
  });
  it("failed re-registration stays failed rather than claiming a healthy idle state", async () => {
    const maintenance = new WorkerMaintenance({ configuredToAccept: true, stopConsumers: async () => {}, startConsumers: async () => { throw new Error("controlled startup error"); } });
    maintenance.request({ action: "drain", operationId }); await maintenance.settled();
    maintenance.request({ action: "resume", operationId }); await maintenance.settled();
    expect(maintenance.snapshot()).toMatchObject({ phase: "failed", safeToReplace: false });
  });
});

describe("actual loopback maintenance HTTP boundary", () => {
  it("authenticates bounded commands, preserves standby, rejects conflicts and never reveals request content", async () => {
    const stopConsumers = vi.fn(async () => {}); const startConsumers = vi.fn(async () => {});
    const controller = new WorkerMaintenance({ configuredToAccept: false, stopConsumers, startConsumers });
    let ready = true;
    const server = createServer((request, response) => { void handleMaintenanceHttp(request, response, { secret, ready: () => ready, controller: () => controller }); });
    await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/maintenance`;
    async function post(value: unknown, override?: { signature?: string; contentType?: string }) {
      const text = typeof value === "string" ? value : JSON.stringify(value); const timestamp = String(Date.now());
      return fetch(url, { method: "POST", body: text, headers: {
        "content-type": override?.contentType ?? "application/json",
        "x-ir35-maintenance-timestamp": timestamp,
        "x-ir35-maintenance-signature": override?.signature ?? signMaintenanceBody(secret, text, timestamp),
      } });
    }
    try {
      expect((await fetch(url)).status).toBe(404);
      expect((await post({ action: "drain", operationId }, { contentType: "text/plain" })).status).toBe(415);
      expect((await post({ action: "drain", operationId }, { signature: "wrong" })).status).toBe(401);
      const redacted = await post({ action: "drain", operationId, secretMarker: "controlled-never-echo" });
      expect(redacted.status).toBe(401); expect(await redacted.text()).not.toContain("controlled-never-echo");
      expect((await post("x".repeat(513))).status).toBe(413);
      const drained = await post({ action: "drain", operationId });
      expect(drained.status).toBe(202); await controller.settled();
      expect(controller.snapshot().safeToReplace).toBe(true);
      expect((await post({ action: "drain", operationId: otherId })).status).toBe(409);
      expect((await post({ action: "resume", operationId })).status).toBe(202); await controller.settled();
      expect(controller.snapshot().phase).toBe("idle");
      expect(startConsumers).not.toHaveBeenCalled(); expect(stopConsumers).not.toHaveBeenCalled();
      ready = false; expect((await post({ action: "drain", operationId: otherId })).status).toBe(503);
    } finally {
      server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
