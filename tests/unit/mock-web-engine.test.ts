import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MockWebLedger, mockWebLedgerSQL } from "../../services/application-worker/mock-web-store";
import { processWebMockDelivery } from "../../services/application-worker/mock-web-engine";
import { webMockOwnerOptions } from "../../services/application-worker/mock-web-runtime";
import { MOCK_WEB_CLAIM_PATH, MOCK_WEB_CALLBACK_PATH } from "@/lib/queue/mock-web-http";
import { mockWebIds as ids, mockWebTestEnv } from "../helpers/mock-web-fixture";
import type { MockWebKick } from "@/lib/queue/mock-web-policy";

let db: PGlite, ledger: MockWebLedger;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE ir35_queue; CREATE ROLE ir35_queue_producer; CREATE ROLE anon;
    CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE authenticator;
    CREATE SCHEMA pgboss AUTHORIZATION ir35_queue; SET ROLE ir35_queue;
    ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT,INSERT ON TABLES TO ir35_queue_producer;`);
  await db.exec(mockWebLedgerSQL);
  const owner = { getDb: () => ({ executeSql: (sql: string, parameters?: unknown[]) => db.query(sql, parameters) }) } as unknown as PgBoss;
  ledger = new MockWebLedger(owner);
}, 30_000);
afterAll(async () => { await db?.close(); });
function fixture() {
  const kick: MockWebKick = { kind: "staging_web_mock_delivery", applicationId: randomUUID(), jobId: ids[0], deliveryVersion: 2,
    requestedAt: "2026-10-27T00:00:00Z" };
  const assignment = { applicationId: kick.applicationId, taskId: randomUUID(), attempt: 1, scenario: "success" as const };
  const post = vi.fn(async (path: string, value: unknown): Promise<unknown> => {
    void value; return path === MOCK_WEB_CLAIM_PATH ? { assignment } : { ok: true };
  });
  const browser = vi.fn(async (): Promise<unknown> => ({ ok: true, receiptConfirmed: true, submissions: 1 }));
  const release = vi.fn(async () => undefined), browserLease = vi.fn(async () => ({ release }));
  return { kick, assignment, deps: { ledger, post, browser, browserLease }, release };
}
describe("durable private web mock outbox and one-browser engine", () => {
  it("excludes every app role and the producer, even under the queue owner's inherited default grants", async () => {
    for (const role of ["anon", "authenticated", "service_role", "authenticator", "ir35_queue_producer"])
      expect((await db.query("SELECT has_table_privilege($1,'pgboss.ir35_mock_web_delivery','SELECT,INSERT,UPDATE,DELETE') AS allowed", [role])).rows[0]).toEqual({ allowed: false });
  });
  it("preserves the first kick and stable claim identity across duplicate delivery", async () => {
    const { kick } = fixture(), first = await ledger.remember(kick);
    expect(await ledger.remember({ ...kick, requestedAt: "2026-10-27T01:00:00Z" })).toEqual(first);
    await expect(ledger.remember({ ...kick, jobId: ids[1] })).rejects.toThrow("identity conflict");
  });
  it("persists the marker before ONE browser and the outcome before a callback", async () => {
    const { kick, deps, release } = fixture();
    deps.browser.mockImplementationOnce(async () => {
      expect((await ledger.remember(kick)).state).toBe("started");
      return { ok: true, receiptConfirmed: true, submissions: 1 };
    });
    deps.post.mockImplementation(async (path, value) => {
      if (path === MOCK_WEB_CLAIM_PATH) return { assignment: { applicationId: kick.applicationId, taskId: randomUUID(), attempt: 1, scenario: "success" } };
      expect(path).toBe(MOCK_WEB_CALLBACK_PATH);
      expect((await ledger.remember(kick)).outcome).toEqual(value);
      expect(release).toHaveBeenCalledTimes(1);
      return { ok: true };
    });
    await processWebMockDelivery(kick, deps);
    expect((await ledger.remember(kick))).toMatchObject({ state: "acknowledged", outcome: { outcome: "submitted", mockReceiptConfirmed: true } });
    expect(deps.browser).toHaveBeenCalledTimes(1);
    await processWebMockDelivery(kick, deps); expect(deps.browser).toHaveBeenCalledTimes(1);
  });
  it("redelivers only the durable outcome after lost callback acknowledgement", async () => {
    const { kick, deps } = fixture();
    let callbacks = 0;
    deps.post.mockImplementation(async path => path === MOCK_WEB_CLAIM_PATH
      ? { assignment: { applicationId: kick.applicationId, taskId: randomUUID(), attempt: 1, scenario: "success" } }
      : (++callbacks === 1 ? Promise.reject(new Error("fixture dropped ACK")) : { ok: true, duplicate: true }));
    await expect(processWebMockDelivery(kick, deps)).rejects.toThrow("dropped ACK");
    const before = (await ledger.remember(kick)).outcome;
    expect((await ledger.remember(kick)).state).toBe("outcome");
    await processWebMockDelivery(kick, deps);
    expect((await ledger.remember(kick))).toMatchObject({ state: "acknowledged", outcome: before });
    expect(deps.browser).toHaveBeenCalledTimes(1); expect(callbacks).toBe(2);
  });
  it("recovers the SAME persisted identity after a lost claim response, with no duplicate browser", async () => {
    const { kick, deps, assignment } = fixture();
    deps.post.mockRejectedValueOnce(new Error("fixture dropped claim ACK"));
    await expect(processWebMockDelivery(kick, deps)).rejects.toThrow();
    const identity = (await ledger.remember(kick)).workerId;
    await processWebMockDelivery(kick, deps);
    expect(deps.post.mock.calls.filter(([path]) => path === MOCK_WEB_CLAIM_PATH).map(([, value]) => value)).toEqual([
      expect.objectContaining({ workerId: identity, recoverLease: true }), expect.objectContaining({ workerId: identity, recoverLease: true }),
    ]);
    expect(deps.post).toHaveBeenLastCalledWith(MOCK_WEB_CALLBACK_PATH, expect.objectContaining({ taskId: assignment.taskId }));
    expect(deps.browser).toHaveBeenCalledTimes(1);
  });
  it("a process crash after start becomes unknown failure, NEVER a second browser", async () => {
    const { kick, assignment, deps } = fixture();
    await ledger.remember(kick); await ledger.claim(kick, assignment); expect(await ledger.start(kick)).toBe(true);
    await processWebMockDelivery(kick, deps);
    expect(deps.browser).not.toHaveBeenCalled(); expect(deps.browserLease).not.toHaveBeenCalled();
    expect((await ledger.remember(kick))).toMatchObject({ state: "acknowledged", outcome: { outcome: "failed", failure: "mock_unknown_outcome", mockReceiptConfirmed: false } });
  });
  it.each(["mock_ats_http_500", "mock_ats_timeout", "mock_unknown_outcome", "mock_captcha_required", "mock_input_required"] as const)("retains visible %s without browser resubmission", async failure => {
    const { kick, deps } = fixture(); deps.browser.mockResolvedValue({ ok: false, errorCode: failure, submissions: 0 });
    await processWebMockDelivery(kick, deps);
    expect((await ledger.remember(kick)).outcome).toMatchObject({ outcome: "failed", failure, mockReceiptConfirmed: false });
    await processWebMockDelivery(kick, deps); expect(deps.browser).toHaveBeenCalledTimes(1);
  });
  it("does not promote an unconfirmed or malformed browser success", async () => {
    const { kick, deps } = fixture(); deps.browser.mockResolvedValue({ ok: true, submissions: 1 });
    await processWebMockDelivery(kick, deps);
    expect((await ledger.remember(kick)).outcome).toMatchObject({ outcome: "failed", failure: "mock_browser_failed" });
  });
  it("rejects personal fields before a ledger/browser/control call", async () => {
    const { kick, deps } = fixture();
    await expect(processWebMockDelivery({ ...kick, cv: "forbidden" }, deps)).rejects.toThrow();
    expect(deps.post).not.toHaveBeenCalled(); expect(deps.browser).not.toHaveBeenCalled();
    expect((await db.query("SELECT count(*)::int AS n FROM pgboss.ir35_mock_web_delivery WHERE application_id=$1", [kick.applicationId])).rows[0]).toEqual({ n: 0 });
  });
  it("neither overwrites a persisted outcome nor acknowledges without one", async () => {
    const { kick, assignment, deps } = fixture(); await processWebMockDelivery(kick, deps);
    const before = await ledger.remember(kick);
    await expect(ledger.outcome(kick, { kind: "staging_web_mock_result", applicationId: kick.applicationId, taskId: assignment.taskId,
      attempt: 1, outcome: "failed", failure: "mock_unknown_outcome", mockReceiptConfirmed: false })).rejects.toThrow("cannot overwrite");
    expect(await ledger.remember(kick)).toEqual(before);
    const queued = fixture().kick; await ledger.remember(queued); await expect(ledger.acknowledge(queued)).rejects.toThrow("no persisted outcome");
  });
  it("keeps direct app/provider credentials out of the consumer and enforces queue-owner pool two", async () => {
    const env = { ...mockWebTestEnv(), PG_BOSS_DATABASE_URL: "postgres://ir35_queue:fake@127.0.0.1:5432/postgres", QUEUE_DB_ALLOWED_HOSTS: "127.0.0.1" };
    expect(await webMockOwnerOptions(env)).toMatchObject({ max: 2, migrate: false, ssl: false, supervise: false, registerInstance: false });
    for (const extra of [{ SUPABASE_SECRET_KEY: "fake" }, { NEXT_PUBLIC_SUPABASE_URL: "https://DO-NOT-CALL.invalid" },
      { PG_BOSS_PRODUCER_DATABASE_URL: "fake" }, { RESEND_API_KEY: "fake" }, { EMAIL_PROVIDER_API_KEY: "fake" }])
      await expect(webMockOwnerOptions({ ...env, ...extra })).rejects.toThrow();
  });
});
