import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestLifecycleDb } from "../helpers/application-lifecycle-db";
import { lifecycleSdkFixture, mockWebIds as ids, mockWebTestEnv, mockWebTestUser as user } from "../helpers/mock-web-fixture";
import { mockWebPolicy, type MockWebKick } from "@/lib/queue/mock-web-policy";
import { isMockWebMode, requireMockWebPolicy, requireMockWebAccount, requireMockWebJob,
  submitMockWebApplication, handleMockWebControl } from "@/lib/queue/mock-web-server";
import { mockWebSignature, MOCK_WEB_CLAIM_PATH, MOCK_WEB_CALLBACK_PATH } from "@/lib/queue/mock-web-http";

const env = mockWebTestEnv(), policy = mockWebPolicy(env)!;
let db: PGlite;
const admin = () => lifecycleSdkFixture(db);
const worker = `staging-web-mock-${randomUUID()}`;
beforeAll(async () => {
  db = await createTestLifecycleDb();
  await db.exec("ALTER TABLE jobs ADD COLUMN apply_url text");
  await db.query("INSERT INTO auth.users VALUES($1)", [user]);
  for (const job of ids) await db.query("INSERT INTO jobs(id,apply_url) VALUES($1,$2)", [job, `https://mock-ats.invalid/${policy.scenarioFor(job)}`]);
}, 30_000);
afterAll(async () => { await db?.close(); });
async function packet() {
  const id = randomUUID();
  await db.query(`INSERT INTO application_packets(id,user_id,job_id,job_snapshot,status,idempotency_key,
    truth_approved,materials_approved,submission_approved) VALUES($1::uuid,$2,$3,'{}','ready',$1::text,true,true,true)`, [id, user, ids[0]]);
  return id;
}
async function state(id: string) {
  return (await db.query<{ delivery_status: string; delivery_version: number; failure_reason: string | null; receipt: unknown }>(
    "SELECT delivery_status,delivery_version,failure_reason,receipt FROM application_packets WHERE id=$1", [id])).rows[0];
}
function signed(kind: "claim" | "callback", value: unknown, extra: Record<string, string> = {}) {
  const path = kind === "claim" ? MOCK_WEB_CLAIM_PATH : MOCK_WEB_CALLBACK_PATH;
  const body = JSON.stringify(value), timestamp = Date.now().toString();
  return new Request(`http://private-fixture.invalid${path}`, { method: "POST", body, headers: {
    "content-type": "application/json", "x-ir35-web-mock-timestamp": timestamp,
    "x-ir35-web-mock-signature": mockWebSignature(env.APPLICATION_WORKER_SECRET, timestamp, "POST", path, body), ...extra,
  } });
}
async function enqueue(id: string, publish: (value: MockWebKick) => Promise<void> = vi.fn(async () => undefined), retry = false) {
  return submitMockWebApplication({ admin: admin(), policy, applicationId: id, userId: user, retry, publish });
}
async function claim(id: string, version: number) {
  const response = await handleMockWebControl(signed("claim", { kind: "staging_web_mock_claim", applicationId: id,
    jobId: ids[0], deliveryVersion: version, workerId: worker }), "claim", admin, env);
  expect(response.status).toBe(200);
  return (await response.json()).assignment as { applicationId: string; taskId: string; attempt: number; scenario: string } | null;
}

describe("web mock canonical SQL bridge (in-memory PostgreSQL, no network)", () => {
  it("never routes disabled/bad mock configuration into a real runner", () => {
    expect(isMockWebMode({})).toBe(false);
    expect(isMockWebMode({ APPLY_RUNNER: "mock" })).toBe(true);
    expect(isMockWebMode({ IR35_MOCK_WEB_ENABLED: "bad" })).toBe(true);
    expect(() => requireMockWebPolicy({ APPLY_RUNNER: "mock" })).toThrow("isolated mock");
    expect(() => requireMockWebAccount("customer@invalid.test")).toThrow();
  });
  it("rejects an unowned server job before writing", async () => {
    await expect(requireMockWebJob(admin(), policy, randomUUID())).rejects.toThrow();
    await db.query("UPDATE jobs SET apply_url='https://employer.invalid/DO-NOT-CALL' WHERE id=$1", [ids[5]]);
    await expect(requireMockWebJob(admin(), policy, ids[5])).rejects.toThrow();
    await db.query("UPDATE jobs SET apply_url=$2 WHERE id=$1", [ids[5], "https://mock-ats.invalid/unknown_answer"]);
  });
  it("rejects unsigned, legacy-purpose, and malformed signed requests before opening a DB", async () => {
    const open = vi.fn(admin);
    const value = { kind: "staging_web_mock_claim", applicationId: randomUUID(), jobId: ids[0], deliveryVersion: 1, workerId: worker };
    expect((await handleMockWebControl(signed("claim", value, { "x-ir35-web-mock-signature": "bad" }), "claim", open, env)).status).toBe(401);
    expect((await handleMockWebControl(signed("claim", { ...value, cv: "FORBIDDEN-PERSONAL-DATA" }), "claim", open, env)).status).toBe(400);
    expect((await handleMockWebControl(signed("claim", value), "claim", open, { ...env, APPLICATION_WORKER_ACCEPT_JOBS: "true" })).status).toBe(503);
    expect(open).not.toHaveBeenCalled();
  });
  it("queues opaque IDs once and claims the exact task without personal fields", async () => {
    const id = await packet(), publish = vi.fn<(value: MockWebKick) => Promise<void>>(async () => undefined);
    expect((await enqueue(id, publish)).status).toBe(202);
    const saved = await state(id);
    expect(saved.delivery_status).toBe("queued");
    expect(Object.keys(publish.mock.calls[0][0]).sort()).toEqual(["applicationId", "deliveryVersion", "jobId", "kind", "requestedAt"]);
    const assignment = await claim(id, saved.delivery_version);
    expect(assignment).toMatchObject({ applicationId: id, attempt: 1, scenario: "success" });
    expect(Object.keys(assignment!).sort()).toEqual(["applicationId", "attempt", "scenario", "taskId"]);
    expect((await state(id)).delivery_status).toBe("submitting");
    expect(await claim(id, saved.delivery_version)).toBeNull();
    const before = await db.query("SELECT attempts,status,lease_owner FROM application_worker_tasks WHERE application_id=$1", [id]);
    expect((await enqueue(id, publish)).status).toBe(202);
    expect(await db.query("SELECT attempts,status,lease_owner FROM application_worker_tasks WHERE application_id=$1", [id])).toEqual(before);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("lost publish acknowledgement becomes a visible failure, never Ready, with explicit retry", async () => {
    const id = await packet();
    await expect(enqueue(id, vi.fn(async () => { throw new Error("secret-sentinel"); }))).rejects.toThrow("isolated mock");
    expect(await state(id)).toMatchObject({ delivery_status: "failed", failure_reason: "mock_queue_unavailable" });
    await expect(enqueue(id)).rejects.toThrow();
    expect((await enqueue(id, undefined, true)).status).toBe(202);
    const assignment = await claim(id, (await state(id)).delivery_version);
    expect(assignment?.attempt).toBe(1);
  });
  it("commits a mock confirmation atomically and ignores duplicated/lost-ACK callbacks", async () => {
    const id = await packet(); await enqueue(id);
    const assignment = (await claim(id, (await state(id)).delivery_version))!;
    const value = { kind: "staging_web_mock_result", applicationId: id, taskId: assignment.taskId, attempt: assignment.attempt,
      outcome: "submitted", failure: null, mockReceiptConfirmed: true };
    expect((await handleMockWebControl(signed("callback", value), "callback", admin, env)).status).toBe(200);
    const saved = await state(id);
    expect(saved).toMatchObject({ delivery_status: "submitted", receipt: { mockOnly: true } });
    expect((await db.query("SELECT status FROM application_worker_tasks WHERE id=$1", [assignment.taskId])).rows[0]).toEqual({ status: "completed" });
    expect((await db.query("SELECT status FROM application_submissions WHERE application_id=$1", [id])).rows[0]).toEqual({ status: "succeeded" });
    expect(await (await handleMockWebControl(signed("callback", value), "callback", admin, env)).json()).toEqual({ ok: true, duplicate: true });
    expect(await state(id)).toEqual(saved);
  });
  it("persists failure and rejects a stale callback across explicit retry", async () => {
    const id = await packet(); await enqueue(id);
    const first = (await claim(id, (await state(id)).delivery_version))!;
    const failure = { kind: "staging_web_mock_result", applicationId: id, taskId: first.taskId, attempt: first.attempt,
      outcome: "failed", failure: "mock_unknown_outcome", mockReceiptConfirmed: false };
    expect((await handleMockWebControl(signed("callback", failure), "callback", admin, env)).status).toBe(200);
    expect(await state(id)).toMatchObject({ delivery_status: "failed", failure_reason: "mock_unknown_outcome" });
    await enqueue(id, undefined, true);
    const next = (await claim(id, (await state(id)).delivery_version))!;
    expect(next.attempt).toBe(2);
    const before = await state(id);
    expect(await (await handleMockWebControl(signed("callback", failure), "callback", admin, env)).json()).toEqual({ ok: true, duplicate: true });
    expect(await state(id)).toEqual(before);
  });
  it("recovers a lost claim ACK only for the explicitly recovering SAME worker, without a new attempt", async () => {
    const id = await packet(); await enqueue(id);
    const version = (await state(id)).delivery_version, assignment = await claim(id, version);
    const value = { kind: "staging_web_mock_claim", applicationId: id, jobId: ids[0], deliveryVersion: version,
      workerId: worker, recoverLease: true };
    expect(await (await handleMockWebControl(signed("claim", value), "claim", admin, env)).json()).toEqual({ assignment });
    expect(await (await handleMockWebControl(signed("claim", { ...value, workerId: `staging-web-mock-${randomUUID()}` }), "claim", admin, env)).json()).toEqual({ assignment: null });
    expect((await db.query("SELECT attempts FROM application_worker_tasks WHERE application_id=$1", [id])).rows[0]).toEqual({ attempts: 1 });
  });
  it("heartbeat watchdog fails only expired named-account fixture work; never a copied customer task", async () => {
    const isolated = await createTestLifecycleDb(), other = "22222222-2222-4222-8222-222222222222";
    const stuck = randomUUID(), otherApp = randomUUID(), calls: string[] = [];
    let clock: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await isolated.exec("ALTER TABLE jobs ADD COLUMN apply_url text");
      await isolated.query("INSERT INTO jobs(id,apply_url) VALUES($1,'https://mock-ats.invalid/success')", [ids[0]]);
      await isolated.query("INSERT INTO auth.users VALUES($1),($2)", [user, other]);
      for (const [id, owner] of [[stuck, user], [otherApp, other]]) {
        await isolated.query(`INSERT INTO application_packets(id,user_id,job_id,job_snapshot,status,idempotency_key,
          truth_approved,materials_approved,submission_approved) VALUES($1::uuid,$2,$3,'{}','ready',$1::text,true,true,true)`, [id, owner, ids[0]]);
        await isolated.query("SELECT transition_application_delivery($1,$2,'queued',NULL,NULL,false)", [id, owner]);
      }
      const read = async (id: string) => (await isolated.query("SELECT * FROM application_packets WHERE id=$1", [id])).rows[0];
      const before = await read(otherApp);
      const open = () => lifecycleSdkFixture(isolated, { calls, users: { [other]: "synthetic-other-customer@invalid.test" } });
      // The production DB trigger remains untouched; simulate elapsed time at
      // the boundary's clock, not by disabling a guard or changing a timeout.
      clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 660_000);
      const heartbeat = { kind: "staging_web_mock_heartbeat", workerId: worker, startedAt: "2026-10-27T00:00:00Z",
        active: 0, completed: 0, failed: 0, buildSha: "a".repeat(40) };
      const response = await handleMockWebControl(signed("claim", heartbeat), "claim", open, env);
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, timedOut: 1 });
      expect(await read(stuck)).toMatchObject({ delivery_status: "failed", failure_reason: "runner_timeout" });
      expect(await read(otherApp)).toEqual(before);
      expect(calls).not.toContain("POST /rest/v1/rpc/fail_abandoned_application_tasks");
    } finally { clock?.mockRestore(); await isolated.close(); }
  });
  it("refuses another account before task or publication writes", async () => {
    const id = await packet(), publish = vi.fn(async () => undefined), calls: string[] = [];
    await expect(submitMockWebApplication({ admin: lifecycleSdkFixture(db, { email: "customer@invalid.test", calls }), policy,
      applicationId: id, userId: user, retry: false, publish })).rejects.toThrow();
    expect(calls.every(call => call.startsWith("GET "))).toBe(true);
    expect(publish).not.toHaveBeenCalled();
    expect((await state(id)).delivery_status).toBe("awaiting_approval");
  });
});
