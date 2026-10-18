import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { APPLY_QUEUE, WORK_QUEUES, queueName } from "../../src/lib/queue/config";

const identitySchema = z.object({
  name: z.string(), session_name: z.string(), login: z.boolean(), privileged: z.boolean(), membership: z.boolean(),
  database_create: z.boolean(), schemas: z.array(z.string()),
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function denied(operation: () => Promise<unknown>, label: string) {
  try { await operation(); }
  catch (error) {
    assert(z.object({ code: z.literal("42501") }).safeParse(error).success,
      `Queue permission probe did not fail with insufficient_privilege: ${label}`);
    return;
  }
  throw new Error(`Queue permission unexpectedly allowed: ${label}`);
}

/** Disposable CI fixtures only; real TCP identities are exercised by Docker CI. */
export async function verifyQueuePermissions(worker: PgBoss, producer: PgBoss) {
  for (const [boss, name, ownedSchemas] of [
    [worker, "ir35_queue", ["pgboss"]], [producer, "ir35_queue_producer", []],
  ] as const) {
    const result = await boss.getDb().executeSql(`SELECT current_user AS name, session_user AS session_name, rolcanlogin AS login,
      (rolsuper OR rolcreaterole OR rolcreatedb OR rolinherit OR rolbypassrls OR rolreplication) AS privileged,
      EXISTS(SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS membership,
      has_database_privilege(current_database(), 'CREATE') AS database_create,
      ARRAY(SELECT nspname::text FROM pg_namespace WHERE nspowner = r.oid ORDER BY nspname) AS schemas
      FROM pg_roles r WHERE rolname = current_user`);
    const identity = identitySchema.parse(result.rows[0]);
    assert(identity.name === name && identity.session_name === name && identity.login && !identity.privileged && !identity.membership &&
      !identity.database_create && JSON.stringify(identity.schemas) === JSON.stringify(ownedSchemas),
    `Queue role has unexpected identity, ownership or elevated privileges: ${name}`);
    for (const schema of ["public", "auth", "storage"] as const) {
      await denied(() => boss.getDb().executeSql(`SELECT * FROM ${schema}.ir35_ci_private LIMIT 0`), `${name}:read_${schema}`);
      await denied(() => boss.getDb().executeSql(`CREATE TABLE ${schema}.ir35_ci_forbidden(id integer)`), `${name}:create_${schema}`);
    }
  }

  const browserAccess = await worker.getDb().executeSql(`SELECT
    has_schema_privilege('anon', 'pgboss', 'USAGE') AS anonymous,
    has_schema_privilege('authenticated', 'pgboss', 'USAGE') AS authenticated`);
  const browserPrivileges = z.object({ anonymous: z.boolean(), authenticated: z.boolean() }).parse(browserAccess.rows[0]);
  assert(!browserPrivileges.anonymous && !browserPrivileges.authenticated, "Browser roles can access the private queue schema");
  assert(JSON.stringify((await producer.getQueues()).map(queue => queue.name).sort()) ===
    JSON.stringify(WORK_QUEUES.map(queueName).sort()), "Expected exactly the seven configured queues");
  const id = await producer.send(APPLY_QUEUE, { kickId: randomUUID(), reason: "ci_permissions_only" }, { singletonKey: randomUUID() });
  assert(typeof id === "string", "Producer did not acknowledge a real queue insert");
  await denied(() => producer.fetch(APPLY_QUEUE), "producer:consume");
  await denied(() => producer.complete(APPLY_QUEUE, id), "producer:complete");
  await denied(() => producer.cancel(APPLY_QUEUE, id), "producer:cancel");
  await denied(() => producer.deleteJob(APPLY_QUEUE, id), "producer:delete");
  await denied(() => producer.createQueue("ir35-ci-forbidden"), "producer:create_queue");
  await denied(() => producer.getDb().executeSql("TRUNCATE pgboss.job"), "producer:truncate");
  await denied(() => producer.getDb().executeSql("SET ROLE ir35_queue"), "producer:become_owner");

  const [job] = await worker.fetch(APPLY_QUEUE);
  assert(job?.id === id, "Queue owner did not claim the producer's job");
  await worker.complete(APPLY_QUEUE, id);

  // Prove defaults apply to objects created later, not just today's tables.
  await worker.getDb().executeSql("CREATE TABLE pgboss.ir35_ci_future(id integer); CREATE SEQUENCE pgboss.ir35_ci_sequence");
  try {
    await producer.getDb().executeSql("INSERT INTO pgboss.ir35_ci_future VALUES (1)");
    await producer.getDb().executeSql("SELECT id FROM pgboss.ir35_ci_future; SELECT nextval('pgboss.ir35_ci_sequence')");
    await denied(() => producer.getDb().executeSql("UPDATE pgboss.ir35_ci_future SET id = 2"), "producer:future_update");
    await denied(() => producer.getDb().executeSql("CREATE TABLE pgboss.ir35_ci_forbidden(id integer)"), "producer:ddl");
  } finally {
    await worker.getDb().executeSql("DROP TABLE pgboss.ir35_ci_future; DROP SEQUENCE pgboss.ir35_ci_sequence");
  }
  return { queues: WORK_QUEUES.length, enqueued: true, consumedByOwner: true, privateDataDenied: true };
}
