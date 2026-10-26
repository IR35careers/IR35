import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { PgBoss, Db } from "pg-boss";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_APPLY_QUEUE, MOCK_SCHEDULE_QUEUE, STAGING_TEST_ACCOUNT } from "@/lib/queue/mock-config";

const controls = vi.hoisted(() => ({ instances: [] as unknown[], server: undefined as Server | undefined }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "172.30.35.2", family: 4 }]) }));
vi.mock("pg-boss", async () => {
  const actual = await vi.importActual<typeof import("pg-boss")>("pg-boss");
  return { ...actual, PgBoss: vi.fn(function () {
    const instance = controls.instances.shift();
    if (!instance) throw new Error("Only the two in-memory queue identities are allowed.");
    return instance;
  }) };
});
vi.mock("node:http", async () => {
  const actual = await vi.importActual<typeof import("node:http")>("node:http");
  return { ...actual, createServer: ((...args: Parameters<typeof actual.createServer>) => {
    const server = actual.createServer(...args);
    const listen = server.listen.bind(server);
    server.listen = (() => listen(0, "127.0.0.1")) as typeof server.listen;
    controls.server = server;
    return server;
  }) };
});
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const { EventEmitter } = await vi.importActual<typeof import("node:events")>("node:events");
  const { PassThrough } = await vi.importActual<typeof import("node:stream")>("node:stream");
  return { ...actual, spawn: vi.fn(() => {
    // Browser protocol health only; no native browser, process or network API.
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), pid: undefined });
    child.stdin.once("finish", () => queueMicrotask(() => {
      child.stdout.emit("data", JSON.stringify({ ok: true, browserReady: true, submissions: 0 }));
      child.emit("close", 0);
    }));
    return child;
  }) };
});

import { MockStore, mockSchemaSQL } from "../../services/application-worker/mock-store";
import { mockSignature, runMockWorker } from "../../services/application-worker/mock-runtime";

let database: PGlite, owner: PgBoss, producer: PgBoss, origin: string;
let gate = Promise.resolve();
let timers: Array<ReturnType<typeof setInterval>> = [];
let previousTerm: NodeJS.SignalsListener[], previousInt: NodeJS.SignalsListener[];
const publicFixtureHmac = "a".repeat(64);

function identity(role: "ir35_queue" | "ir35_queue_producer", adapter: Db): Db {
  async function acquire() {
    const previous = gate;
    let release!: () => void;
    gate = new Promise<void>(resolve => { release = resolve; });
    await previous;
    return release;
  }
  return {
    async executeSql(text, values) {
      const release = await acquire();
      await database.exec(`SET SESSION AUTHORIZATION ${role}`);
      try { return await adapter.executeSql(text, values); }
      finally { await database.exec("RESET SESSION AUTHORIZATION"); release(); }
    },
    async beginTransaction() {
      const release = await acquire();
      await database.exec(`SET SESSION AUTHORIZATION ${role}; BEGIN`);
      let settled = false;
      async function finish(sql: string) {
        if (settled) return;
        settled = true;
        try { await database.exec(sql); }
        finally { await database.exec("RESET SESSION AUTHORIZATION"); release(); }
      }
      return { db: adapter, commit: () => finish("COMMIT"), rollback: () => finish("ROLLBACK") };
    },
  };
}

beforeEach(async () => {
  controls.server = undefined; controls.instances = []; timers = []; gate = Promise.resolve();
  database = new PGlite(); await database.waitReady;
  const actual = await vi.importActual<typeof import("pg-boss")>("pg-boss");
  await database.exec(readFileSync("tests/fixtures/queue/roles.sql", "utf8"));
  await database.exec("SET ROLE ir35_queue");
  await database.exec(actual.getConstructionPlans("pgboss", { createSchema: false, backend: "pglite" }));
  await database.exec(mockSchemaSQL); await database.exec("RESET ROLE");
  const adapter = actual.fromPglite(database);
  const common = { schema: "pgboss", backend: "pglite" as const, migrate: false, supervise: false, schedule: false, registerInstance: false };
  owner = new actual.PgBoss({ ...common, db: identity("ir35_queue", adapter) });
  producer = new actual.PgBoss({ ...common, db: identity("ir35_queue_producer", adapter) });
  await owner.start();
  for (const name of [MOCK_APPLY_QUEUE, MOCK_SCHEDULE_QUEUE]) await owner.createQueue(name, { policy: "short", retryLimit: 0, expireInSeconds: 60, heartbeatSeconds: 15 });
  await owner.getDb().executeSql(readFileSync("supabase/operations/pgboss-producer-grants.sql", "utf8"));
  await producer.start();
  controls.instances.push(owner, producer);
  vi.spyOn(owner, "fetch").mockResolvedValue([]);
  vi.spyOn(MockStore.prototype, "browserLease").mockResolvedValue({ db: owner.getDb(), release: async () => {} });
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((...args: Parameters<typeof setInterval>) => {
    const timer = interval(...args); timers.push(timer); return timer;
  }) as typeof setInterval);
  previousTerm = process.listeners("SIGTERM"); previousInt = process.listeners("SIGINT");
}, 30_000);

async function boot(overrides: Record<string, string> = {}) {
  await runMockWorker({ APPLY_RUNNER: "mock", IR35_STAGING: "true", APPLICATION_WORKER_ACCEPT_JOBS: "false",
    APPLICATION_WORKER_CONCURRENCY: "1", IR35_READ_ONLY: "false", IR35_SCHEDULER_ENABLED: "false",
    APPLICATION_WORKER_SECRET: publicFixtureHmac, IR35_BUILD_SHA: "b".repeat(40),
    IR35CAREERS_APP_URL: "https://staging.ir35careers.com", QUEUE_DB_ALLOWED_HOSTS: "db",
    PG_BOSS_DATABASE_URL: "postgresql://ir35_queue:public-fixture@db:5432/postgres",
    PG_BOSS_PRODUCER_DATABASE_URL: "postgresql://ir35_queue_producer:public-fixture@db:5432/postgres", ...overrides });
  const server = controls.server!;
  if (!server.listening) await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback HTTP fixture missing.");
  origin = `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  for (const timer of timers) clearInterval(timer);
  controls.server?.closeAllConnections();
  if (controls.server?.listening) await new Promise<void>(resolve => controls.server!.close(() => resolve()));
  for (const listener of process.listeners("SIGTERM")) if (!previousTerm?.includes(listener)) process.removeListener("SIGTERM", listener);
  for (const listener of process.listeners("SIGINT")) if (!previousInt?.includes(listener)) process.removeListener("SIGINT", listener);
  await owner?.stop({ graceful: false }); await producer?.stop({ graceful: false }); await database?.close();
  vi.restoreAllMocks();
});

const work = () => ({ kind: "staging_mock_application", applicationId: randomUUID(), actorEmail: STAGING_TEST_ACCOUNT,
  scenario: "success", requestedAt: "2026-10-26T06:00:00.000Z" });
async function post(value: unknown) {
  return command("/mock/applications", value);
}
async function command(path: "/mock/applications" | "/mock/maintenance", value: unknown) {
  const body = JSON.stringify(value), timestamp = String(Date.now());
  return fetch(origin + path, { method: "POST", body, headers: { "content-type": "application/json",
    "x-ir35-mock-timestamp": timestamp, "x-ir35-mock-signature": mockSignature(publicFixtureHmac, timestamp, "POST", path, body) } });
}
async function counts() {
  const rows = await owner.getDb().executeSql("SELECT (SELECT count(*) FROM pgboss.ir35_mock_application)::int AS applications,(SELECT count(*) FROM pgboss.job)::int AS jobs");
  return rows.rows[0];
}

describe("real HTTP status and real SQL queue publication", () => {
  it("rejects extra employer fields with400, the same error body and no transaction or writes", async () => {
    await boot();
    const begin = vi.spyOn(producer.getDb(), "beginTransaction"), send = vi.spyOn(producer, "send");
    const response = await post({ ...work(), employerURL: "https://forbidden.invalid/apply" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_mock_request_or_unavailable" });
    expect(begin).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ applications: 0, jobs: 0 });
  });
  it("returns202 only after valid work is committed and queues a duplicate exactly once", async () => {
    await boot();
    const input = work(), send = vi.spyOn(producer, "send");
    const first = await post(input);
    expect(first.status).toBe(202);
    const receipt = await first.json();
    expect(receipt).toMatchObject({ applicationId: input.applicationId, state: "queued", errorCode: null, receiptConfirmed: false });
    expect(await counts()).toEqual({ applications: 1, jobs: 1 });
    const second = await post(input);
    expect(second.status).toBe(202); expect(await second.json()).toEqual(receipt);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await counts()).toEqual({ applications: 1, jobs: 1 });
  });
  it("does not report202 when queue publication fails, and rolls back the application insert", async () => {
    await boot();
    vi.spyOn(producer, "send").mockResolvedValueOnce(null);
    const response = await post(work());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_mock_request_or_unavailable" });
    expect(await counts()).toEqual({ applications: 0, jobs: 0 });
  });
  it("starts paused without accepting work, then resumes only an enabled mock consumer", async () => {
    await boot({ IR35_MOCK_START_PAUSED: "true" });
    expect(await (await fetch(origin + "/health")).json()).toMatchObject({ paused: true, active: 0, realAcceptance: false });
    expect((await post(work())).status).toBe(503);
    expect(await counts()).toEqual({ applications: 0, jobs: 0 });
    expect(await (await command("/mock/maintenance", { action: "resume" })).json()).toEqual({ paused: false, realAcceptance: false });
    expect((await post(work())).status).toBe(202);
    expect(await counts()).toEqual({ applications: 1, jobs: 1 });
  });
  it("never lets maintenance resume override the global read-only gate", async () => {
    await boot({ IR35_MOCK_START_PAUSED: "true", IR35_READ_ONLY: "true" });
    expect(await (await command("/mock/maintenance", { action: "resume" })).json()).toEqual({ paused: true, realAcceptance: false });
    expect((await post(work())).status).toBe(503);
    expect(await counts()).toEqual({ applications: 0, jobs: 0 });
  });
});
