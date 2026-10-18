import { afterEach, describe, expect, it, vi } from "vitest";
import { pgBossOptions, railwayWorkerConfig, workQueueOptions } from "@/lib/queue/config";
import { applyRunnerExecution, selectedApplyRunner } from "@/lib/application-runner-selection";
import { managedApplicationQueueEnabled } from "@/lib/application-cloud-queue";
import { kickApplicationWorker } from "@/lib/application-worker-kick";
import { disposableQueuePermissionOptions } from "../../services/application-worker/queue-permission-config";

const queue = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), send: vi.fn(), options: vi.fn() }));
vi.mock("pg-boss", () => ({ PgBoss: class {
  constructor(options: unknown) { queue.options(options); }
  on() { return this; }
  start = queue.start;
  stop = queue.stop;
  send = queue.send;
} }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function configure() {
  vi.stubEnv("PG_BOSS_DATABASE_URL", "postgres://queue.project:secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=disable");
  vi.stubEnv("APPLY_RUNNER", "railway");
  vi.stubEnv("APPLICATION_WORKER_ENABLED", "true");
  vi.stubEnv("APPLICATION_WORKER_SECRET", "test-only-not-a-real-secret-1234567890");
  vi.stubEnv("IR35CAREERS_APP_URL", "https://www.ir35careers.com");
}

describe("Railway queue safety", () => {
  it("defaults to Vercel and rejects a misspelled runner", () => {
    vi.stubEnv("APPLY_RUNNER", undefined);
    expect(selectedApplyRunner()).toBe("vercel");
    vi.stubEnv("APPLY_RUNNER", "railwai");
    expect(() => selectedApplyRunner()).toThrow("APPLY_RUNNER");
  });
  it("does not run the managed Vercel consumer in Railway mode", () => {
    configure(); vi.stubEnv("VERCEL", "1");
    expect(managedApplicationQueueEnabled()).toBe(false);
    expect(applyRunnerExecution()).toBe("railway_pg_boss");
  });
  it("requires session pooling and redacts invalid connection strings", () => {
    configure();
    const options = pgBossOptions("producer");
    expect(options).toMatchObject({ schema: "pgboss", max: 1, migrate: false, supervise: false, schedule: false, registerInstance: false, ssl: { rejectUnauthorized: true } });
    expect(options.connectionString).not.toContain("sslmode");
    for (const value of ["postgres://u:private@db.example.com:5432/postgres", "postgres://u:private@aws-0-eu-west-2.pooler.supabase.com:6543/postgres", "private"]) {
      vi.stubEnv("PG_BOSS_DATABASE_URL", value);
      try { pgBossOptions("producer"); throw new Error("Unexpected success"); }
      catch (error) { expect(String(error)).not.toContain("private"); expect(String(error)).toContain("5432"); }
    }
  });
  it("starts in standby with bounded concurrency and two transport retries", () => {
    configure(); vi.stubEnv("APPLICATION_WORKER_ACCEPT_JOBS", undefined); vi.stubEnv("APPLICATION_WORKER_CONCURRENCY", undefined);
    expect(railwayWorkerConfig()).toMatchObject({ APPLICATION_WORKER_ACCEPT_JOBS: "false", APPLICATION_WORKER_CONCURRENCY: 1 });
    expect(workQueueOptions()).toMatchObject({ retryLimit: 2, expireInSeconds: 600, heartbeatSeconds: 60 });
    vi.stubEnv("APPLICATION_WORKER_CONCURRENCY", "10");
    expect(() => railwayWorkerConfig()).toThrow("Invalid Railway");
  });
  it("validates a separate producer URL without replacing the worker environment", () => {
    configure();
    const original = process.env.PG_BOSS_DATABASE_URL;
    const url = "postgres://ir35_queue_producer.project:ci-only@aws-0-eu-west-2.pooler.supabase.com:5432/postgres";
    expect(pgBossOptions("producer", url).connectionString).toContain("ir35_queue_producer.project");
    expect(process.env.PG_BOSS_DATABASE_URL).toBe(original);
    expect(() => pgBossOptions("producer", "invalid-private-value")).toThrow("session pooler");
  });
  it.each([
    { NODE_ENV: "production", PG_BOSS_LOCAL_TEST: "true" },
    { NODE_ENV: "test", PG_BOSS_LOCAL_TEST: "false" },
    { NODE_ENV: "test", PG_BOSS_LOCAL_TEST: "true" },
  ])("refuses the disposable permission probe outside a loopback test database: %o", gates => {
    const url = "postgres://ir35_queue:must-not-appear@aws-0-eu-west-2.pooler.supabase.com:5432/postgres";
    for (const [key, value] of Object.entries(gates)) vi.stubEnv(key, value);
    vi.stubEnv("PG_BOSS_DATABASE_URL", url);
    vi.stubEnv("PG_BOSS_PRODUCER_TEST_DATABASE_URL", url);
    expect(() => disposableQueuePermissionOptions()).toThrow(/local-test gates|loopback Postgres/);
    try { disposableQueuePermissionOptions(); }
    catch (error) { expect(String(error)).not.toContain("must-not-appear"); }
  });
  it("requires the separate producer URL even with both disposable-test gates", () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("PG_BOSS_LOCAL_TEST", "true");
    vi.stubEnv("PG_BOSS_PRODUCER_TEST_DATABASE_URL", undefined);
    expect(() => disposableQueuePermissionOptions()).toThrow("local-test gates");
  });
  it("accepts two loopback identities only with every disposable-test gate", () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("PG_BOSS_LOCAL_TEST", "true");
    vi.stubEnv("PG_BOSS_DATABASE_URL", "postgres://ir35_queue:ci-only@127.0.0.1:5432/postgres");
    vi.stubEnv("PG_BOSS_PRODUCER_TEST_DATABASE_URL", "postgres://ir35_queue_producer:ci-only@127.0.0.1:5432/postgres");
    expect(disposableQueuePermissionOptions()).toMatchObject({
      worker: { max: 4, ssl: false, migrate: false }, producer: { max: 1, ssl: false, migrate: false, supervise: false },
    });
  });
  it("permits loopback Postgres only with both explicit test gates", () => {
    configure(); vi.stubEnv("PG_BOSS_DATABASE_URL", "postgres://ci:local-only@127.0.0.1:5432/postgres");
    vi.stubEnv("PG_BOSS_LOCAL_TEST", "true"); vi.stubEnv("NODE_ENV", "production");
    expect(() => pgBossOptions("setup")).toThrow("session pooler");
    vi.stubEnv("NODE_ENV", "test");
    expect(pgBossOptions("setup").ssl).toBe(false);
  });
  it("only enqueues opaque IDs and closes producer resources", async () => {
    configure(); queue.send.mockResolvedValue("test-message");
    await expect(kickApplicationWorker({ applicationId: "2344d4ef-4afd-42c3-b4f0-979e671e81a7", delaySeconds: 30 })).resolves.toBe("accepted");
    expect(queue.send).toHaveBeenCalledWith("ir35-apply", expect.objectContaining({ applicationId: "2344d4ef-4afd-42c3-b4f0-979e671e81a7" }), expect.objectContaining({ startAfter: 30, retryLimit: 2 }));
    expect(Object.keys(queue.send.mock.calls[0][1]).sort()).toEqual(["applicationId", "kickId", "reason", "requestedAt"]);
    expect(queue.stop).toHaveBeenCalledOnce();
  });
  it("never falls back to a browser on queue publication failure", async () => {
    configure(); queue.send.mockRejectedValue(new Error("postgres://secret@private"));
    await expect(kickApplicationWorker({ applicationId: "2344d4ef-4afd-42c3-b4f0-979e671e81a7" })).rejects.toThrow("No submission is confirmed");
    expect(queue.stop).toHaveBeenCalledOnce();
  });
  it("accepts a queue-policy duplicate without starting another attempt", async () => {
    configure(); queue.send.mockResolvedValue(null);
    await expect(kickApplicationWorker({ applicationId: "2344d4ef-4afd-42c3-b4f0-979e671e81a7" })).resolves.toBe("accepted");
  });
});
