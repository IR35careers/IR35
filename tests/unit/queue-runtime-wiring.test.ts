import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pgBossOptions, queueRuntimeOptions } from "@/lib/queue/config";
import { enqueueRailwayApplication, enqueueScheduledWork } from "@/lib/queue/producer";

const fixture = "public-fixture-not-a-real-queue-password";
const url = (host: string, query = "") => `postgresql://ir35_queue:${fixture}@${host}:5432/postgres${query}`;
const dns = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ address: string; family: number }[]>>());
const queue = vi.hoisted(() => ({ options: vi.fn(), start: vi.fn(), stop: vi.fn(), send: vi.fn(), constructError: false }));
vi.mock("node:dns/promises", () => ({ lookup: dns }));
vi.mock("pg-boss", () => ({ PgBoss: class {
  constructor(options: unknown) { queue.options(options); if (queue.constructError) throw new Error("postgresql://PUBLIC-FAKE-CONSTRUCTOR-PRIVATE"); }
  on() { return this; }
  start = queue.start; stop = queue.stop; send = queue.send;
} }));
beforeEach(() => {
  vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", "db"); vi.stubEnv("PG_BOSS_DATABASE_URL", url("db"));
  vi.stubEnv("PG_BOSS_SSL_CA", undefined);
  dns.mockResolvedValue([{ address: "172.18.0.2", family: 4 }]);
  queue.send.mockResolvedValue("public-fixture-queue-id"); queue.constructError = false;
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("actual queue runtime wiring, not a validator-only wrapper", () => {
  it.each(["producer", "worker", "setup"] as const)("awaits exact-host/DNS pinning for real %s options and keeps its policy", async mode => {
    const options = await queueRuntimeOptions(mode);
    expect(new URL(options.connectionString!).hostname).toBe("172.18.0.2");
    expect(options).toMatchObject({ ssl: false, schema: "pgboss", max: mode === "producer" ? 1 : 4,
      createSchema: false, migrate: mode === "setup", supervise: mode === "worker", schedule: false,
      registerInstance: mode === "worker", instanceHeartbeatSeconds: 15, application_name: `ir35-${mode}` });
    expect(dns).toHaveBeenCalledExactlyOnceWith("db", { all: true, verbatim: true });
  });
  it("normal producer constructs pg-boss only after validated private DNS and enqueues once", async () => {
    await enqueueRailwayApplication({ kickId: "00000000-0000-4000-8000-000000000001", applicationId: "00000000-0000-4000-8000-000000000002", reason: "public-fixture", requestedAt: "2026-10-27T00:00:00.000Z" });
    expect(queue.options).toHaveBeenCalledOnce();
    expect(new URL(queue.options.mock.calls[0][0].connectionString).hostname).toBe("172.18.0.2");
    expect(queue.options.mock.calls[0][0].ssl).toBe(false);
    expect(dns.mock.invocationCallOrder[0]).toBeLessThan(queue.options.mock.invocationCallOrder[0]);
    expect(queue.send).toHaveBeenCalledOnce(); expect(queue.stop).toHaveBeenCalledOnce();
  });
  it("scheduled publication uses the same real producer boundary", async () => {
    await enqueueScheduledWork("ingest");
    expect(queue.send).toHaveBeenCalledWith("ir35-ingest", expect.objectContaining({ operation: "ingest" }), expect.any(Object));
    expect(new URL(queue.options.mock.calls[0][0].connectionString).hostname).toBe("172.18.0.2");
    expect(queue.stop).toHaveBeenCalledOnce();
  });
  it("does not construct a database client for unlisted/private-public DNS, wildcard or public no-TLS input", async () => {
    for (const change of [
      { allowlist: "", host: "db", answers: [{ address: "172.18.0.2", family: 4 }] },
      { allowlist: "db,*", host: "db", answers: [{ address: "172.18.0.2", family: 4 }] },
      { allowlist: "db", host: "db", answers: [{ address: "172.18.0.2", family: 4 }, { address: "203.0.113.2", family: 4 }] },
      { allowlist: "public.example.test", host: "public.example.test", answers: [{ address: "203.0.113.2", family: 4 }] },
    ]) {
      vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", change.allowlist); vi.stubEnv("PG_BOSS_DATABASE_URL", url(change.host)); dns.mockResolvedValue(change.answers);
      await expect(enqueueScheduledWork("ingest")).rejects.not.toThrow(fixture);
    }
    expect(queue.options).not.toHaveBeenCalled(); expect(queue.start).not.toHaveBeenCalled(); expect(queue.send).not.toHaveBeenCalled();
  });
  it("keeps existing Supabase verified TLS and strips untrusted connection parameters", async () => {
    vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", "");
    const options = await queueRuntimeOptions("worker", url("aws-0-eu-west-2.pooler.supabase.com", "?sslmode=disable&sslrootcert=/private-fixture"));
    expect(options.ssl).toEqual({ rejectUnauthorized: true });
    expect(options.connectionString).not.toContain("?"); expect(dns).not.toHaveBeenCalled();
    expect(options).toEqual(pgBossOptions("worker", url("aws-0-eu-west-2.pooler.supabase.com", "?sslmode=disable&sslrootcert=/private-fixture")));
  });
  it("does not turn the old local-test flags into an implicit runtime allowlist", async () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("PG_BOSS_LOCAL_TEST", "true"); vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", "");
    await expect(queueRuntimeOptions("worker", url("127.0.0.1"))).rejects.toThrow("exact QUEUE_DB_ALLOWED_HOSTS");
    expect(dns).not.toHaveBeenCalled();
  });
  it("redacts third-party constructor failures instead of propagating a connection string", async () => {
    queue.constructError = true;
    let message = "";
    try { await enqueueScheduledWork("ingest"); } catch (error) { message = String(error); }
    expect(message).toContain("No submission is confirmed");
    expect(message).not.toContain("postgresql://"); expect(message).not.toContain("PUBLIC-FAKE-CONSTRUCTOR-PRIVATE");
    expect(queue.send).not.toHaveBeenCalled(); expect(queue.stop).not.toHaveBeenCalled();
  });
  it("does not leak a driver shutdown error after an acknowledged publication", async () => {
    queue.stop.mockRejectedValue(new Error("postgresql://PUBLIC-FAKE-SHUTDOWN-PRIVATE"));
    let message = "";
    try { await enqueueScheduledWork("ingest"); } catch (error) { message = String(error); }
    expect(message).toContain("No submission is confirmed");
    expect(message).not.toContain("postgresql://"); expect(message).not.toContain("PUBLIC-FAKE-SHUTDOWN-PRIVATE");
    expect(queue.send).toHaveBeenCalledOnce(); expect(queue.stop).toHaveBeenCalledOnce();
  });
  it("rejects unknown runtime modes before DNS or construction", async () => {
    await expect(queueRuntimeOptions("invalid" as never)).rejects.toThrow("Invalid queue connection mode");
    expect(dns).not.toHaveBeenCalled(); expect(queue.options).not.toHaveBeenCalled();
  });
  it("pins executable setup/worker entrypoints and both native CI standbys to the new boundary", () => {
    for (const [file, mode] of [["services/application-worker/setup-queue.ts", "setup"], ["services/application-worker/railway.ts", "worker"]]) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).toContain(`new PgBoss(await queueRuntimeOptions("${mode}"))`);
      expect(source).not.toContain("new PgBoss(pgBossOptions(");
    }
    for (const file of [".github/workflows/quality.yml", ".github/workflows/oracle-arm64.yml"]) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source.match(/QUEUE_DB_ALLOWED_HOSTS=127\.0\.0\.1/g)).toHaveLength(2);
      expect(source).toContain("APPLICATION_WORKER_ACCEPT_JOBS=false");
    }
  });
});
