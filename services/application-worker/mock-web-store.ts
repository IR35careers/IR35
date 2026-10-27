import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { mockWebKickSchema, mockWebAssignmentSchema, mockWebResultSchema, type MockWebKick } from "../../src/lib/queue/mock-web-policy";

/** A new queue-only ledger. Never alter the P6 ledger or any app/Auth/Storage
 * table; the queue logins remain unable to connect to those databases.
 */
export const mockWebLedgerSQL = `BEGIN;
CREATE TABLE pgboss.ir35_mock_web_delivery (
 application_id uuid NOT NULL, delivery_version bigint NOT NULL CHECK(delivery_version>0), job_id uuid NOT NULL,
 worker_id text NOT NULL CHECK(worker_id ~ '^staging-web-mock-[a-f0-9-]{36}$'),
 kick jsonb NOT NULL, assignment jsonb, outcome jsonb,
 state text NOT NULL CHECK(state IN ('queued','claimed','started','outcome','acknowledged','superseded')),
 updated_at timestamptz NOT NULL DEFAULT now(), callback_failures integer NOT NULL DEFAULT 0 CHECK(callback_failures>=0),
 PRIMARY KEY(application_id,delivery_version),
 CHECK((state IN ('claimed','started','outcome','acknowledged'))=(assignment IS NOT NULL)),
 CHECK((state IN ('outcome','acknowledged'))=(outcome IS NOT NULL)));
REVOKE ALL ON pgboss.ir35_mock_web_delivery FROM PUBLIC,anon,authenticated,service_role,authenticator,ir35_queue_producer;
COMMIT;`;

export const webMockRecordSchema = z.object({ kick: mockWebKickSchema,
  workerId: z.string().refine(value => value.startsWith("staging-web-mock-") && z.uuid().safeParse(value.slice(17)).success),
  state: z.enum(["queued", "claimed", "started", "outcome", "acknowledged", "superseded"]),
  assignment: mockWebAssignmentSchema.nullable(), outcome: mockWebResultSchema.nullable(),
});
export type WebMockRecord = z.infer<typeof webMockRecordSchema>;
export type WebMockAssignment = z.infer<typeof mockWebAssignmentSchema>;
export type WebMockResult = z.infer<typeof mockWebResultSchema>;
export interface WebMockLedger {
  remember(kick: MockWebKick): Promise<WebMockRecord>;
  claim(kick: MockWebKick, assignment: WebMockAssignment): Promise<void>;
  start(kick: MockWebKick): Promise<boolean>;
  outcome(kick: MockWebKick, result: WebMockResult): Promise<void>;
  acknowledge(kick: MockWebKick): Promise<void>;
  supersede(kick: MockWebKick): Promise<void>;
}

const projection = "jsonb_build_object('kick',kick,'workerId',worker_id,'state',state,'assignment',assignment,'outcome',outcome) AS value";
export class MockWebLedger implements WebMockLedger {
  constructor(private readonly owner: PgBoss) {}
  async remember(input: MockWebKick): Promise<WebMockRecord> {
    const kick = mockWebKickSchema.parse(input), db = this.owner.getDb();
    await db.executeSql(`INSERT INTO pgboss.ir35_mock_web_delivery(application_id,delivery_version,job_id,worker_id,kick,state)
      VALUES($1,$2,$3,$4,$5,'queued') ON CONFLICT(application_id,delivery_version) DO NOTHING`,
    [kick.applicationId, kick.deliveryVersion, kick.jobId, `staging-web-mock-${randomUUID()}`, JSON.stringify(kick)]);
    const result = await db.executeSql(`SELECT ${projection} FROM pgboss.ir35_mock_web_delivery WHERE application_id=$1 AND delivery_version=$2`, [kick.applicationId, kick.deliveryVersion]);
    const record = webMockRecordSchema.parse(result.rows[0]?.value);
    if (record.kick.applicationId !== kick.applicationId || record.kick.deliveryVersion !== kick.deliveryVersion || record.kick.jobId !== kick.jobId)
      throw new Error("Isolated mock ledger identity conflict.");
    return record;
  }
  private async change(kick: MockWebKick, sql: string, extra: unknown[] = []) {
    const value = mockWebKickSchema.parse(kick);
    return this.owner.getDb().executeSql(sql, [value.applicationId, value.deliveryVersion, ...extra]);
  }
  async claim(kick: MockWebKick, value: WebMockAssignment): Promise<void> {
    const assignment = mockWebAssignmentSchema.parse(value);
    if (assignment.applicationId !== kick.applicationId) throw new Error("Mock assignment identity conflict.");
    const changed = await this.change(kick, `UPDATE pgboss.ir35_mock_web_delivery SET state='claimed',assignment=$3,updated_at=now()
      WHERE application_id=$1 AND delivery_version=$2 AND state='queued' RETURNING application_id`, [JSON.stringify(assignment)]);
    if (changed.rows.length !== 1) throw new Error("Mock claim ledger changed concurrently.");
  }
  async start(kick: MockWebKick): Promise<boolean> {
    const result = await this.change(kick, `UPDATE pgboss.ir35_mock_web_delivery SET state='started',updated_at=now()
      WHERE application_id=$1 AND delivery_version=$2 AND state='claimed' RETURNING application_id`);
    return result.rows.length === 1;
  }
  async outcome(kick: MockWebKick, value: WebMockResult): Promise<void> {
    const result = mockWebResultSchema.parse(value);
    if (result.applicationId !== kick.applicationId) throw new Error("Mock result identity conflict.");
    const saved = await this.change(kick, `UPDATE pgboss.ir35_mock_web_delivery SET state='outcome',outcome=$3,updated_at=now()
      WHERE application_id=$1 AND delivery_version=$2 AND state IN ('claimed','started') AND outcome IS NULL
      AND assignment->>'taskId'=$4 AND (assignment->>'attempt')::integer=$5 RETURNING application_id`,
    [JSON.stringify(result), result.taskId, result.attempt]);
    if (saved.rows.length !== 1) throw new Error("Mock outcome cannot overwrite a persisted attempt.");
  }
  async acknowledge(kick: MockWebKick): Promise<void> {
    const changed = await this.change(kick, `UPDATE pgboss.ir35_mock_web_delivery SET state='acknowledged',updated_at=now()
      WHERE application_id=$1 AND delivery_version=$2 AND state='outcome' RETURNING application_id`);
    if (changed.rows.length !== 1) throw new Error("Mock acknowledgement has no persisted outcome.");
  }
  async supersede(kick: MockWebKick): Promise<void> {
    const changed = await this.change(kick, `UPDATE pgboss.ir35_mock_web_delivery SET state='superseded',updated_at=now()
      WHERE application_id=$1 AND delivery_version=$2 AND state='queued' RETURNING application_id`);
    if (changed.rows.length !== 1) throw new Error("A claimed mock attempt cannot be silently superseded.");
  }
  async defer(kick: MockWebKick): Promise<void> {
    await this.change(kick, `UPDATE pgboss.ir35_mock_web_delivery SET callback_failures=callback_failures+1,updated_at=now()
      WHERE application_id=$1 AND delivery_version=$2 AND state NOT IN ('acknowledged','superseded')`);
  }
  async pending(): Promise<MockWebKick[]> {
    const result = await this.owner.getDb().executeSql(`SELECT kick FROM pgboss.ir35_mock_web_delivery
      WHERE state NOT IN ('acknowledged','superseded') AND updated_at<now()-interval '15 seconds' ORDER BY updated_at LIMIT 20`);
    return result.rows.map(row => mockWebKickSchema.parse(row.kick));
  }
}
