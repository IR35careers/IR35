import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PgBoss, fromPglite, getConstructionPlans, type Db } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_APPLY_QUEUE, MOCK_SCHEDULE_QUEUE, STAGING_TEST_ACCOUNT } from "@/lib/queue/mock-config";
import { MockStore, mockSchemaSQL } from "../../services/application-worker/mock-store";

let database: PGlite, owner: PgBoss, producer: PgBoss, store: MockStore;
let gate = Promise.resolve();
async function acquire() {
  const previous = gate; let release!: () => void;
  gate = new Promise<void>(resolve => { release = resolve; });
  await previous; return release;
}
function identity(role: "ir35_queue" | "ir35_queue_producer"): Db {
  const adapter = fromPglite(database);
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
      const end = async (sql: string) => {
        if (settled) return; settled = true;
        try { await database.exec(sql); } finally { await database.exec("RESET SESSION AUTHORIZATION"); release(); }
      };
      return { db: adapter, commit: () => end("COMMIT"), rollback: () => end("ROLLBACK") };
    },
  };
}
const work = (scenario = "success") => ({ kind: "staging_mock_application", applicationId: randomUUID(), actorEmail: STAGING_TEST_ACCOUNT,
  scenario, requestedAt: "2026-10-24T12:00:00.000Z" });

beforeEach(async () => {
  database = new PGlite(); await database.waitReady; gate = Promise.resolve();
  await database.exec(readFileSync("tests/fixtures/queue/roles.sql", "utf8"));
  await database.exec("SET ROLE ir35_queue");
  await database.exec(getConstructionPlans("pgboss", { createSchema: false, backend: "pglite" }));
  await database.exec(mockSchemaSQL); await database.exec("RESET ROLE");
  const common = { schema: "pgboss", backend: "pglite" as const, migrate: false, supervise: false, schedule: false, registerInstance: false };
  owner = new PgBoss({ ...common, db: identity("ir35_queue") }); producer = new PgBoss({ ...common, db: identity("ir35_queue_producer") });
  await owner.start();
  for (const name of [MOCK_APPLY_QUEUE, MOCK_SCHEDULE_QUEUE]) await owner.createQueue(name, { policy: "short", retryLimit: 0, expireInSeconds: 60, heartbeatSeconds: 15 });
  await owner.getDb().executeSql(readFileSync("supabase/operations/pgboss-producer-grants.sql", "utf8"));
  await producer.start(); store = new MockStore(owner, producer);
}, 30_000);
afterEach(async () => { await owner?.stop({ graceful: false }); await producer?.stop({ graceful: false }); await database?.close(); vi.restoreAllMocks(); });

describe("durable real-SQL mock lifecycle, private schema only", () => {
  it("runs the exact native ACL read-back query against PostgreSQL before any service start", async () => {
    const source = readFileSync("infra/oracle/p6_mock_guest.py", "utf8");
    const sql = source.match(/privilege=json.loads\(original.query\("""([\s\S]*?)""",'postgres'/)?.[1];
    expect(sql).toBeTruthy();
    const result = await owner.getDb().executeSql(sql!);
    expect(result.rows[0].jsonb_build_object).toEqual({ owner: "ir35_queue", anonUsage: false, authenticatedUsage: false,
      producerCreate: false, producerUnexpectedMutation: false, queues: [MOCK_APPLY_QUEUE, MOCK_SCHEDULE_QUEUE] });
  });

  it("atomically enqueues once, persists all transitions and reloads a confirmed receipt", async () => {
    const input = work(); expect(await store.enqueue(input)).toMatchObject({ state: "queued", receiptConfirmed: false });
    expect(await store.enqueue(input)).toMatchObject({ state: "queued" });
    expect(await owner.fetch(MOCK_APPLY_QUEUE, { batchSize: 10 })).toHaveLength(1);
    const attempt = await store.claim(input.applicationId); expect(attempt).toBeTruthy();
    expect(await store.claim(input.applicationId)).toBeNull();
    await store.transition(input.applicationId, attempt!, "submitting");
    await store.transition(input.applicationId, attempt!, "submitted");
    const reloaded = await new MockStore(owner, producer).get(input.applicationId);
    expect(reloaded).toMatchObject({ state: "submitted", receiptConfirmed: true, errorCode: null });
    expect(reloaded!.events.map(event => event.state)).toEqual(["queued", "running", "submitting", "submitted"]);
    await expect(store.transition(input.applicationId, attempt!, "failed", "mock_unknown_outcome")).rejects.toThrow("never overwritten");
    await expect(store.enqueue({ ...input, scenario: "server_error" })).rejects.toThrow("no submission is confirmed");
  });

  it("rolls the application insert back when queue publication has no acknowledgement", async () => {
    const input = work(); vi.spyOn(producer, "send").mockResolvedValue(null);
    await expect(store.enqueue(input)).rejects.toThrow("no submission is confirmed");
    expect(await store.get(input.applicationId)).toBeNull();
  });

  it("keeps visible failed/unknown outcomes terminal, never resets them to Ready or retries a browser", async () => {
    const input = work("lost_ack"); await store.enqueue(input);
    const attempt = await store.claim(input.applicationId); await store.transition(input.applicationId, attempt!, "submitting");
    await store.transition(input.applicationId, attempt!, "failed", "mock_unknown_outcome");
    expect(await store.get(input.applicationId)).toMatchObject({ state: "failed", errorCode: "mock_unknown_outcome", receiptConfirmed: false });
    expect(await store.claim(input.applicationId)).toBeNull();
    await expect(store.transition(input.applicationId, attempt!, "submitted")).rejects.toThrow("never overwritten");
    expect((await store.enqueue(input))!.events.map(event => event.state)).toEqual(["queued", "running", "submitting", "failed"]);
  });

  it("watchdogs only an expired disposable mock lease and rejects a stale completion", async () => {
    const input = work("timeout"); await store.enqueue(input);
    const attempt = await store.claim(input.applicationId); await store.transition(input.applicationId, attempt!, "submitting");
    expect(await store.watchdog()).toBe(0);
    // This is the new synthetic table in the local test DB, never source data.
    await owner.getDb().executeSql("UPDATE pgboss.ir35_mock_application SET lease_until=now()-interval '1 second' WHERE id=$1", [input.applicationId]);
    expect(await store.watchdog()).toBe(1); expect(await store.watchdog()).toBe(0);
    expect(await store.get(input.applicationId)).toMatchObject({ state: "failed", errorCode: "runner_timeout", receiptConfirmed: false });
    await expect(store.transition(input.applicationId, attempt!, "submitted")).rejects.toThrow("never overwritten");
  });

  it("producer can insert/read but cannot update/delete/consume/DDL/escalate or read customer schemas", async () => {
    const input = work(); await store.enqueue(input);
    for (const sql of ["UPDATE pgboss.ir35_mock_application SET state='queued'", "DELETE FROM pgboss.ir35_mock_application",
      "CREATE TABLE pgboss.forbidden(id integer)", "SET ROLE ir35_queue", "SELECT * FROM auth.ir35_ci_private", "SELECT * FROM public.ir35_ci_private", "SELECT * FROM storage.ir35_ci_private"]) {
      await expect(producer.getDb().executeSql(sql)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(producer.fetch(MOCK_APPLY_QUEUE)).rejects.toMatchObject({ code: "42501" });
    expect((await store.get(input.applicationId))!.state).toBe("queued");
  });

  it("strict work rejects customer actors, employer URLs and malformed IDs before SQL", async () => {
    for (const value of [{ ...work(), actorEmail: "customer@invalid.test" }, { ...work(), employerUrl: "https://employer.invalid" }, { ...work(), applicationId: "bad" }]) {
      await expect(store.enqueue(value)).rejects.toThrow("Invalid isolated mock work");
    }
    expect((await owner.getDb().executeSql("SELECT count(*)::integer AS count FROM pgboss.ir35_mock_application")).rows[0].count).toBe(0);
    await store.heartbeat("a".repeat(40), 1);
    expect((await producer.getDb().executeSql("SELECT active FROM pgboss.ir35_mock_heartbeat")).rows[0].active).toBe(1);
  });
});
