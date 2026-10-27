import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as submit } from "@/app/api/applications/submit/route";
import { POST as claim } from "@/app/api/applications/worker/claim/route";
import { POST as callback } from "@/app/api/applications/worker/callback/route";
import { createTestLifecycleDb } from "../helpers/application-lifecycle-db";
import { lifecycleSdkFixture, mockWebIds as ids, mockWebTestEnv, mockWebTestUser as user } from "../helpers/mock-web-fixture";
import { mockWebSignature, MOCK_WEB_CLAIM_PATH, MOCK_WEB_CALLBACK_PATH } from "@/lib/queue/mock-web-http";

const fixture = vi.hoisted(() => ({ admin: vi.fn(), publish: vi.fn(), alias: vi.fn(), employer: vi.fn(), provider: vi.fn(),
  notifications: vi.fn(), recovery: vi.fn(), after: vi.fn() }));
vi.mock("next/server", () => ({ after: fixture.after }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: fixture.admin }));
vi.mock("@/lib/queue/mock-web-producer", () => ({ publishMockWebApplication: fixture.publish }));
vi.mock("@/lib/email/inbox-alias", () => ({ ensureInboxAlias: fixture.alias, applicationInboxAlias: vi.fn() }));
vi.mock("@/lib/employer-destinations", () => ({ resolveEmployerDestinationForJob: fixture.employer }));
vi.mock("@/lib/application-submission", () => ({ submissionProviderConfig: fixture.provider, submitWithProvider: vi.fn(),
  resumeSubmissionWithProvider: vi.fn(), providerReviewQuestions: vi.fn() }));
vi.mock("@/lib/email/application-notifications", () => ({ sendApplicationNotification: fixture.notifications }));
vi.mock("@/lib/email/recover-pending-verifications", () => ({ recoverPendingVerificationEmails: fixture.recovery }));
let db: PGlite;
const env = mockWebTestEnv();
beforeAll(async () => {
  db = await createTestLifecycleDb();
  await db.exec("ALTER TABLE jobs ADD COLUMN apply_url text");
  await db.query("INSERT INTO auth.users VALUES($1)", [user]);
  await db.query("INSERT INTO jobs(id,apply_url) VALUES($1,'https://mock-ats.invalid/success')", [ids[0]]);
}, 30_000);
afterAll(async () => { await db?.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("VERCEL", undefined);
  fixture.admin.mockImplementation(() => lifecycleSdkFixture(db));
  fixture.publish.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });
function approval(id = randomUUID()) {
  return new Request("https://staging.ir35careers.com/api/applications/submit", { method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer public-fixture-token-not-real" },
    body: JSON.stringify({ applicationId: id, approval: "SUBMIT_APPROVED_APPLICATION" }) });
}
function control(path: string, value: unknown, signature = true) {
  const body = JSON.stringify(value), timestamp = Date.now().toString();
  return new Request(`http://private-fixture.invalid${path}`, { method: "POST", body, headers: {
    "content-type": "application/json", "x-ir35-web-mock-timestamp": timestamp,
    "x-ir35-web-mock-signature": signature ? mockWebSignature(env.APPLICATION_WORKER_SECRET, timestamp, "POST", path, body) : "invalid",
  } });
}
function noLivePaths() {
  for (const spy of [fixture.alias, fixture.employer, fixture.provider, fixture.notifications, fixture.recovery, fixture.after])
    expect(spy).not.toHaveBeenCalled();
}
describe("actual Next API mock routing (real SQL fixture, no server/network)", () => {
  it("fails closed before admin access when mock config is absent", async () => {
    vi.stubEnv("IR35_MOCK_WEB_ENABLED", undefined);
    expect((await submit(approval())).status).toBe(503);
    expect((await claim(control(MOCK_WEB_CLAIM_PATH, {}))).status).toBe(503);
    expect((await callback(control(MOCK_WEB_CALLBACK_PATH, {}))).status).toBe(503);
    expect(fixture.admin).not.toHaveBeenCalled(); noLivePaths();
  });
  it("rejects another contractor before any packet/alias/provider write", async () => {
    const calls: string[] = [];
    fixture.admin.mockImplementation(() => lifecycleSdkFixture(db, { email: "synthetic-other@invalid.test", calls }));
    expect((await submit(approval())).status).toBe(403);
    expect(calls).toEqual(["GET /auth/v1/user"]); expect(fixture.publish).not.toHaveBeenCalled(); noLivePaths();
  });
  it("rejects unauthenticated control requests before opening the app DB", async () => {
    expect((await claim(control(MOCK_WEB_CLAIM_PATH, {}, false))).status).toBe(401);
    expect((await callback(control(MOCK_WEB_CALLBACK_PATH, {}, false))).status).toBe(401);
    expect(fixture.admin).not.toHaveBeenCalled(); noLivePaths();
  });
  it("real submit/claim/callback routes complete a canonical mock task without provider/notification/recovery/after paths", async () => {
    const id = randomUUID();
    await db.query(`INSERT INTO application_packets(id,user_id,job_id,job_snapshot,status,idempotency_key,
      truth_approved,materials_approved,submission_approved) VALUES($1::uuid,$2,$3,'{}','ready',$1::text,true,true,true)`, [id, user, ids[0]]);
    // Simulate an interrupted initial submit after the canonical queued write.
    // The actual route must republish durably, not return a stranded 202.
    await db.query("SELECT transition_application_delivery($1,$2,'queued',NULL,NULL,false)", [id, user]);
    const queued = await submit(approval(id));
    expect(queued.status).toBe(202); expect(await queued.json()).toMatchObject({ deliveryStatus: "queued", mockOnly: true });
    expect(fixture.publish).toHaveBeenCalledTimes(1);
    const version = (await db.query<{ delivery_version: number }>("SELECT delivery_version FROM application_packets WHERE id=$1", [id])).rows[0].delivery_version;
    const response = await claim(control(MOCK_WEB_CLAIM_PATH, { kind: "staging_web_mock_claim", applicationId: id,
      jobId: ids[0], deliveryVersion: version, workerId: `staging-web-mock-${randomUUID()}` }));
    expect(response.status).toBe(200);
    const { assignment } = await response.json();
    expect(Object.keys(assignment).sort()).toEqual(["applicationId", "attempt", "scenario", "taskId"]);
    const committed = await callback(control(MOCK_WEB_CALLBACK_PATH, { kind: "staging_web_mock_result", applicationId: id,
      taskId: assignment.taskId, attempt: assignment.attempt, outcome: "submitted", failure: null, mockReceiptConfirmed: true }));
    expect(committed.status).toBe(200); noLivePaths();
    expect((await db.query("SELECT delivery_status FROM application_packets WHERE id=$1", [id])).rows[0]).toEqual({ delivery_status: "submitted" });
  });
});
