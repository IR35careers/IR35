import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { fromPglite, getConstructionPlans, PgBoss, type Db } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WORK_QUEUES, queueName, workQueueOptions } from "@/lib/queue/config";
import { verifyQueuePermissions } from "../../services/application-worker/queue-permission-check";

let database: PGlite;
let worker: PgBoss;
let producer: PgBoss;
let pending: Promise<unknown>;

function asRole(role: "ir35_queue" | "ir35_queue_producer"): Db {
  const adapter = fromPglite(database);
  return {
    executeSql(text, values) {
      // Embedded PostgreSQL has one session. Serialize role switches together
      // with their query and reset so background cache reads cannot leak roles.
      const request = pending.then(async () => {
        // SET ROLE alone retains the superuser SESSION_USER, which would make
        // a SET ROLE escalation probe meaningless. Emulate the login identity.
        await database.exec(`SET SESSION AUTHORIZATION ${role}`);
        try { return await adapter.executeSql(text, values); }
        finally { await database.exec("RESET SESSION AUTHORIZATION"); }
      });
      pending = request.catch(() => undefined);
      return request;
    },
  };
}

beforeEach(async () => {
  database = new PGlite();
  pending = Promise.resolve();
  await database.exec(readFileSync("tests/fixtures/queue/roles.sql", "utf8"));
  await database.exec("SET ROLE ir35_queue");
  await database.exec(getConstructionPlans("pgboss", { createSchema: false, backend: "pglite" }));
  await database.exec("RESET ROLE");
  const common = { schema: "pgboss", backend: "pglite" as const, migrate: false,
    supervise: false, schedule: false, registerInstance: false };
  worker = new PgBoss({ ...common, db: asRole("ir35_queue") });
  producer = new PgBoss({ ...common, db: asRole("ir35_queue_producer") });
  await worker.start();
  for (const name of WORK_QUEUES) await worker.createQueue(queueName(name), workQueueOptions());
  await worker.getDb().executeSql(readFileSync("supabase/operations/pgboss-producer-grants.sql", "utf8"));
  await producer.start();
}, 30_000);

afterEach(async () => {
  await Promise.all([worker?.stop({ graceful: false }), producer?.stop({ graceful: false })]);
  await pending;
  await database?.close();
});

describe("real pg-boss SQL with nonprivileged queue roles", () => {
  it("publishes and owner-consumes work while rejecting consumption, DDL and private-data access by the producer", async () => {
    await expect(verifyQueuePermissions(worker, producer)).resolves.toEqual({
      queues: 7, enqueued: true, consumedByOwner: true, privateDataDenied: true,
    });
  }, 30_000);

  it("catches an accidental UPDATE grant that would let the producer consume", async () => {
    await worker.getDb().executeSql("GRANT UPDATE ON ALL TABLES IN SCHEMA pgboss TO ir35_queue_producer");
    await expect(verifyQueuePermissions(worker, producer)).rejects.toThrow("unexpectedly allowed: producer:consume");
  }, 30_000);

  it("rejects a supposedly separate producer using the owner identity", async () => {
    await expect(verifyQueuePermissions(worker, worker)).rejects.toThrow("unexpected identity, ownership or elevated privileges: ir35_queue_producer");
  }, 30_000);

  it("removes an unintended column UPDATE grant and verifies the effective ACL", async () => {
    await worker.getDb().executeSql("GRANT UPDATE (state) ON pgboss.job_common TO ir35_queue_producer");
    const query = "SELECT has_any_column_privilege('ir35_queue_producer', 'pgboss.job_common', 'UPDATE') AS allowed";
    expect((await worker.getDb().executeSql(query)).rows[0]).toMatchObject({ allowed: true });
    await worker.getDb().executeSql(readFileSync("supabase/operations/pgboss-producer-grants.sql", "utf8"));
    expect((await worker.getDb().executeSql(query)).rows[0]).toMatchObject({ allowed: false });
    await expect(verifyQueuePermissions(worker, producer)).resolves.toMatchObject({ consumedByOwner: true });
  }, 30_000);
});
