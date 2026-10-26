import { randomUUID } from "node:crypto";
import type { Db, JobAttempt, PgBoss } from "pg-boss";
import { z } from "zod";
import { MOCK_APPLY_QUEUE, STAGING_TEST_ACCOUNT, mockApplicationWorkSchema } from "../../src/lib/queue/mock-config";

export const mockFailure = z.enum(["mock_ats_http_500", "mock_ats_timeout", "mock_unknown_outcome", "mock_captcha_required", "mock_input_required", "runner_timeout", "mock_browser_failed", "mock_cancelled"]);
export type MockFailure = z.infer<typeof mockFailure>;
const states = z.enum(["queued", "running", "submitting", "submitted", "failed"]);
const event = z.strictObject({ state: states, at: z.iso.datetime({ offset: true }), errorCode: mockFailure.nullable() });
export const mockReceiptSchema = z.strictObject({ applicationId: z.uuid(), state: states, errorCode: mockFailure.nullable(),
  receiptConfirmed: z.boolean(), updatedAt: z.iso.datetime({ offset: true }), events: z.array(event) });
export type MockReceipt = z.infer<typeof mockReceiptSchema>;

/** Private queue schema only; no customer table, Auth identity or RLS change. */
export const mockSchemaSQL = `CREATE TABLE pgboss.ir35_mock_application (
 id uuid PRIMARY KEY, actor_email text NOT NULL CHECK(actor_email='${STAGING_TEST_ACCOUNT}'),
 scenario text NOT NULL CHECK(scenario IN ('success','server_error','timeout','lost_ack','captcha','unknown_answer')),
 state text NOT NULL CHECK(state IN ('queued','running','submitting','submitted','failed')),
 requested_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), attempt uuid, lease_until timestamptz,
 error_code text, receipt_confirmed boolean NOT NULL DEFAULT false, events jsonb NOT NULL,
 CHECK((state='failed')=(error_code IS NOT NULL)), CHECK((state='submitted')=receipt_confirmed));
CREATE TABLE pgboss.ir35_mock_heartbeat (id text PRIMARY KEY CHECK(id='staging_mock_worker'),
 seen_at timestamptz NOT NULL, build_sha text NOT NULL CHECK(build_sha ~ '^[a-f0-9]{40}$'), active integer NOT NULL CHECK(active BETWEEN 0 AND 1));
CREATE TABLE pgboss.ir35_mock_schedule (id uuid PRIMARY KEY, operation text NOT NULL CHECK(operation IN ('mock_ingest','mock_automation','watchdog')),
 completed_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON pgboss.ir35_mock_application,pgboss.ir35_mock_heartbeat,pgboss.ir35_mock_schedule FROM PUBLIC,anon,authenticated;`;

const receiptSQL = `SELECT jsonb_build_object('applicationId',id,'state',state,'errorCode',error_code,
 'receiptConfirmed',receipt_confirmed,'updatedAt',updated_at,'events',events) AS value
 FROM pgboss.ir35_mock_application WHERE id=$1`;

export class MockStore {
  constructor(readonly owner: PgBoss, readonly producer: PgBoss) {}
  async get(id: string): Promise<MockReceipt | null> {
    const parsed = z.uuid().safeParse(id); if (!parsed.success) throw new Error("Invalid mock application ID.");
    const result = await this.producer.getDb().executeSql(receiptSQL, [parsed.data]);
    return result.rows.length ? mockReceiptSchema.parse(result.rows[0].value) : null;
  }
  async enqueue(input: unknown) {
    const parsed = mockApplicationWorkSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid isolated mock work.");
    const value = parsed.data;
    const begin = this.producer.getDb().beginTransaction;
    if (!begin) throw new Error("Atomic producer transactions are required.");
    const transaction = await begin.call(this.producer.getDb());
    try {
      const existing = await transaction.db.executeSql("SELECT scenario,actor_email,requested_at FROM pgboss.ir35_mock_application WHERE id=$1", [value.applicationId]);
      if (existing.rows.length) {
        const row = existing.rows[0];
        if (row.scenario !== value.scenario || row.actor_email !== value.actorEmail || new Date(row.requested_at).toISOString() !== new Date(value.requestedAt).toISOString()) throw new Error("Mock idempotency conflict.");
      } else {
        await transaction.db.executeSql(`INSERT INTO pgboss.ir35_mock_application(id,actor_email,scenario,state,requested_at,events)
         VALUES($1,$2,$3,'queued',$4,jsonb_build_array(jsonb_build_object('state','queued','at',now(),'errorCode',NULL)))`,
        [value.applicationId, value.actorEmail, value.scenario, value.requestedAt]);
        const job = await this.producer.send(MOCK_APPLY_QUEUE, value, { id: value.applicationId, singletonKey: value.applicationId, retryLimit: 0, db: transaction.db });
        if (job !== value.applicationId) throw new Error("Atomic mock queue acknowledgement missing.");
      }
      await transaction.commit();
    } catch { await transaction.rollback(); throw new Error("Mock publication failed or conflicted; no submission is confirmed."); }
    return this.get(value.applicationId);
  }
  async claim(id: string) {
    const attempt = randomUUID();
    const result = await this.owner.getDb().executeSql(`UPDATE pgboss.ir35_mock_application
     SET state='running',updated_at=clock_timestamp(),attempt=$2,lease_until=clock_timestamp()+interval '45 seconds',
     events=events||jsonb_build_object('state','running','at',clock_timestamp(),'errorCode',NULL)
     WHERE id=$1 AND state='queued' RETURNING id`, [id, attempt]);
    return result.rows.length ? attempt : null;
  }
  async transition(id: string, attempt: string, next: "submitting" | "submitted" | "failed", errorCode: MockFailure | null = null) {
    if (next === "failed") mockFailure.parse(errorCode);
    else if (errorCode !== null) throw new Error("Only explicit failed outcomes have an error code.");
    const from = next === "submitting" ? ["running"] : next === "submitted" ? ["submitting"] : ["running", "submitting"];
    const result = await this.owner.getDb().executeSql(`UPDATE pgboss.ir35_mock_application
     SET state=$3,error_code=$4,receipt_confirmed=($3='submitted'),updated_at=clock_timestamp(),
     events=events||jsonb_build_object('state',$3::text,'at',clock_timestamp(),'errorCode',$4::text)
     WHERE id=$1 AND attempt=$2 AND state=ANY($5::text[]) AND lease_until>clock_timestamp() RETURNING id`, [id, attempt, next, errorCode, from]);
    if (result.rows.length !== 1) throw new Error("Mock outcome lease lost; terminal state is never overwritten.");
  }
  async renew(id: string, attempt: string, job: JobAttempt) {
    z.uuid().parse(id); z.uuid().parse(attempt);
    const claim = z.object({ id: z.uuid(), retryCount: z.number().int().nonnegative() }).parse(job);
    if (claim.id !== id) throw new Error("Mock heartbeat identity mismatch.");
    // Warm pg-boss's public queue cache BEFORE reserving a transaction. A
    // cache miss inside it could otherwise need a third pool connection while
    // browserLease holds one of the two allowed connections.
    const current = await this.owner.getJobById(MOCK_APPLY_QUEUE, id);
    if (!current || current.state !== "active" || current.retryCount !== claim.retryCount) throw new Error("Mock queue attempt lease lost.");
    const begin = this.owner.getDb().beginTransaction;
    if (!begin) throw new Error("Atomic mock heartbeat transaction required.");
    const transaction = await begin.call(this.owner.getDb());
    try {
      // App row BEFORE pg-boss row, like cancel(), avoids cross-table lock
      // inversion. Neither an expired nor a terminal application can revive.
      const updated = await transaction.db.executeSql(`UPDATE pgboss.ir35_mock_application
       SET lease_until=clock_timestamp()+interval '45 seconds'
       WHERE id=$1 AND attempt=$2 AND state IN ('running','submitting') AND lease_until>clock_timestamp() RETURNING id`, [id, attempt]);
      if (updated.rows.length !== 1) throw new Error("Mock application lease lost.");
      const touched = z.object({ affected: z.literal(1), settled: z.tuple([z.uuid()]) }).parse(
        await this.owner.touch(MOCK_APPLY_QUEUE, claim, { db: transaction.db }));
      if (touched.settled[0] !== id) throw new Error("Mock queue attempt lease lost.");
      await transaction.commit();
    } catch { await transaction.rollback(); throw new Error("Mock heartbeat lease lost; browser must stop."); }
  }
  async cancel(id: string): Promise<MockReceipt | null> {
    z.uuid().parse(id);
    await this.owner.getJobById(MOCK_APPLY_QUEUE, id);
    const begin = this.owner.getDb().beginTransaction;
    if (!begin) throw new Error("Atomic mock cancellation transaction required.");
    const transaction = await begin.call(this.owner.getDb());
    try {
      const saved = await transaction.db.executeSql("SELECT state FROM pgboss.ir35_mock_application WHERE id=$1 FOR UPDATE", [id]);
      if (saved.rows.length && ["queued", "running", "submitting"].includes(saved.rows[0].state)) {
        await this.owner.cancel(MOCK_APPLY_QUEUE, id, { db: transaction.db });
        await transaction.db.executeSql(`UPDATE pgboss.ir35_mock_application
         SET state='failed',error_code='mock_cancelled',receipt_confirmed=false,updated_at=clock_timestamp(),
         events=events||jsonb_build_object('state','failed','at',clock_timestamp(),'errorCode','mock_cancelled')
         WHERE id=$1 AND state IN ('queued','running','submitting')`, [id]);
      }
      await transaction.commit();
    } catch { await transaction.rollback(); throw new Error("Mock cancellation could not be confirmed."); }
    return this.get(id);
  }
  async watchdog() {
    const result = await this.owner.getDb().executeSql(`UPDATE pgboss.ir35_mock_application
     SET state='failed',error_code='runner_timeout',receipt_confirmed=false,updated_at=clock_timestamp(),
     events=events||jsonb_build_object('state','failed','at',clock_timestamp(),'errorCode','runner_timeout')
     WHERE (state IN ('running','submitting') AND lease_until<=clock_timestamp())
      OR (state='queued' AND updated_at<clock_timestamp()-interval '45 seconds' AND NOT EXISTS (
       SELECT 1 FROM pgboss.job j WHERE j.name=$1 AND j.id=ir35_mock_application.id AND j.state IN ('created','retry','active')
      )) RETURNING id`, [MOCK_APPLY_QUEUE]);
    return result.rows.length;
  }
  async heartbeat(sha: string, active: number) {
    z.string().regex(/^[a-f0-9]{40}$/).parse(sha); z.number().int().min(0).max(1).parse(active);
    await this.owner.getDb().executeSql(`INSERT INTO pgboss.ir35_mock_heartbeat VALUES('staging_mock_worker',clock_timestamp(),$1,$2)
     ON CONFLICT(id) DO UPDATE SET seen_at=EXCLUDED.seen_at,build_sha=EXCLUDED.build_sha,active=EXCLUDED.active`, [sha, active]);
  }
  async browserLease(): Promise<{ db: Db; release: () => Promise<void> }> {
    const begin = this.owner.getDb().beginTransaction;
    if (!begin) throw new Error("Session-pinned browser exclusion is required.");
    const transaction = await begin.call(this.owner.getDb());
    const result = await transaction.db.executeSql("SELECT pg_try_advisory_xact_lock(17335,6001) AS locked");
    if (result.rows[0]?.locked !== true) { await transaction.rollback(); throw new Error("Another staging browser is active."); }
    return { db: transaction.db, release: () => transaction.rollback() };
  }
}
