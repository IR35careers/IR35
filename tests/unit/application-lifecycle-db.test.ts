import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canTransitionDelivery, isUnresolvedAggregator } from "@/lib/application-lifecycle";
import { createTestLifecycleDb } from "../helpers/application-lifecycle-db";

const user = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
async function packet(id: string) {
  await db.query(`INSERT INTO application_packets(id,user_id,job_snapshot,status,idempotency_key,
    truth_approved,materials_approved,submission_approved) VALUES($1::uuid,$2,'{}','ready',$1::text,true,true,true)`, [id, user]);
}
async function transition(id: string, to: string, reason: string | null = null, retry = false) {
  return db.query("SELECT transition_application_delivery($1,$2,$3,$4,NULL,$5)", [id, user, to, reason, retry]);
}
async function state(id: string) {
  return (await db.query<{ delivery_status: string; failure_reason: string | null; delivery_version: number; status: string }>(
    "SELECT delivery_status,failure_reason,delivery_version,status FROM application_packets WHERE id=$1", [id])).rows[0];
}
beforeAll(async () => {
  db = await createTestLifecycleDb();
  await db.query("INSERT INTO auth.users VALUES($1),($2)", [user, other]);
}, 30_000);
afterAll(async () => { await db?.close(); });

describe("authoritative SQL delivery lifecycle", () => {
  it("never regresses after a stale approved snapshot, and atomically audits transitions", async () => {
    const id = "a1111111-1111-4111-8111-111111111111";
    await packet(id); await transition(id, "queued"); await transition(id, "submitting");
    await db.query("UPDATE application_packets SET status='ready' WHERE id=$1", [id]);
    expect((await state(id)).delivery_status).toBe("submitting");
    await transition(id, "needs_info", "employer_login");
    await db.query("UPDATE application_packets SET status='ready' WHERE id=$1", [id]);
    expect(await state(id)).toMatchObject({ delivery_status: "needs_info", status: "needs_review", failure_reason: "employer_login" });
    await expect(transition(id, "queued")).rejects.toThrow("transition rejected");
    await transition(id, "queued", null, true);
    const events = await db.query<{ from_status: string; to_status: string; failure_reason: string }>(
      "SELECT from_status,to_status,failure_reason FROM application_events WHERE application_id=$1 ORDER BY created_at,id", [id]);
    expect(events.rows.map(row => row.to_status)).toEqual(["awaiting_approval", "queued", "submitting", "needs_info", "queued"]);
    expect(events.rows.find(row => row.to_status === "needs_info")?.failure_reason).toBe("employer_login");
  });
  it("requires a confirmation receipt and preserves it through stale saves", async () => {
    const id = "a2222222-2222-4222-8222-222222222222";
    await packet(id); await transition(id, "queued");
    await expect(transition(id, "submitted")).rejects.toThrow("confirmation receipt");
    await db.query("UPDATE application_packets SET status='applied',mode='external_handoff',receipt=$2 WHERE id=$1", [id,
      JSON.stringify({ receiptId: "mock-ats-receipt", destination: "https://mock.example.test/apply" })]);
    await expect(db.query("UPDATE application_packets SET status='ready',receipt=NULL WHERE id=$1", [id])).rejects.toThrow("cannot be overwritten");
    expect((await state(id)).delivery_status).toBe("submitted");
  });
  it("turns a crashed task into failed with a durable reason", async () => {
    const id = "a3333333-3333-4333-8333-333333333333";
    await packet(id);
    await db.query(`INSERT INTO application_worker_tasks(user_id,application_id,idempotency_key,destination,callback_url)
      VALUES($1,$2::uuid,$2::text,'https://mock.example.test/apply','https://mock.example.test/callback')`, [user, id]);
    await db.query("UPDATE application_worker_tasks SET status='running' WHERE application_id=$1", [id]);
    expect((await state(id)).delivery_status).toBe("submitting");
    await db.query("UPDATE application_worker_tasks SET status='failed',last_error='worker_crash' WHERE application_id=$1", [id]);
    expect(await state(id)).toMatchObject({ delivery_status: "failed", failure_reason: "worker_crash" });
  });
  it("watchdog persists runner_timeout exactly once", async () => {
    const id = "a4444444-4444-4444-8444-444444444444";
    await packet(id);
    await db.query(`INSERT INTO application_worker_tasks(user_id,application_id,idempotency_key,destination,callback_url,status,lease_owner,updated_at)
      VALUES($1,$2::uuid,$2::text,'https://mock.example.test/apply','https://mock.example.test/callback','running','railway-test',now()-interval '11 minutes')`, [user, id]);
    await db.query("SELECT fail_abandoned_application_tasks()");
    expect(await state(id)).toMatchObject({ delivery_status: "failed", failure_reason: "runner_timeout" });
    expect((await db.query("SELECT fail_abandoned_application_tasks() AS affected")).rows[0]).toMatchObject({ affected: 0 });
  });
  it("stores external_only and does not silently resume an aggregator", async () => {
    const id = "a5555555-5555-4555-8555-555555555555";
    await packet(id); await transition(id, "external_only", "unsupported_aggregator");
    await expect(transition(id, "submitting")).rejects.toThrow("transition rejected");
    expect(await state(id)).toMatchObject({ delivery_status: "external_only", failure_reason: "unsupported_aggregator" });
  });
  it("rejects stale versions and another tenant's draft", async () => {
    const id = "a6666666-6666-4666-8666-666666666666";
    await packet(id); await db.query("SELECT set_config('test.user',$1,false)", [user]);
    const draft = JSON.stringify({ id, status: "ready", job_snapshot: {}, source_cv_text: "CV", tailored_cv_text: "CV",
      cover_letter: "", screening_answers: [], resume_version_label: "CV", matched_keywords: [], missing_keywords: [],
      match_score: 80, truth_approved: true, materials_approved: true, submission_approved: true });
    await db.query("SELECT save_application_draft($1,1)", [draft]);
    await expect(db.query("SELECT save_application_draft($1,1)", [draft])).rejects.toThrow("Application changed");
    await db.query("SELECT set_config('test.user',$1,false)", [other]);
    await expect(db.query("SELECT save_application_draft($1,2)", [draft])).rejects.toThrow("Forbidden");
    await db.query("SELECT set_config('test.user','',false)");
  });
  it("does not grant browsers authority to forge delivery states or call transition RPC", async () => {
    expect((await db.query(`SELECT has_function_privilege('authenticated',
      'public.transition_application_delivery(uuid,uuid,text,text,text,boolean)','EXECUTE') AS allowed`)).rows[0]).toMatchObject({ allowed: false });
    expect((await db.query(`SELECT has_column_privilege('authenticated','application_packets','delivery_status','UPDATE') AS allowed`)).rows[0]).toMatchObject({ allowed: false });
    expect((await db.query(`SELECT has_any_column_privilege('authenticated','application_packets','UPDATE') AS updates,
      has_any_column_privilege('authenticated','application_packets','INSERT') AS inserts`)).rows[0])
      .toMatchObject({ updates: false, inserts: false });
  });
  it("removes historical 017 column grants but permits the owner CAS RPC under the actual browser role", async () => {
    const id = "d1111111-1111-4111-8111-111111111111";
    await packet(id);
    await db.query("SELECT set_config('test.user',$1,false)", [user]);
    await db.exec("SET ROLE authenticated");
    try {
      await expect(db.query("UPDATE application_packets SET source_cv_text='stale browser CV' WHERE id=$1", [id]))
        .rejects.toThrow(/permission denied/);
      const saved = await db.query<{ packet: { source_cv_text: string } }>("SELECT save_application_draft($1,1) AS packet", [
        JSON.stringify({ id, status: "ready", job_snapshot: {}, source_cv_text: "Owner-approved CV", tailored_cv_text: "", resume_version_label: "CV",
          cover_letter: "", screening_answers: [], matched_keywords: [], missing_keywords: [], match_score: 80,
          truth_approved: true, materials_approved: true, submission_approved: true }),
      ]);
      expect(saved.rows[0].packet.source_cv_text).toBe("Owner-approved CV");
    } finally {
      await db.exec("RESET ROLE");
      await db.query("SELECT set_config('test.user','',false)");
    }
  });
  it("commits a confirmed outcome and its audit together, idempotently", async () => {
    const id = "a7777777-7777-4777-8777-777777777777";
    await packet(id); await transition(id, "queued"); await transition(id, "submitting");
    const receipt = JSON.stringify({ receiptId: "mock-ats-7", destination: "https://mock.example.test/apply", createdAt: new Date().toISOString() });
    await db.query("SELECT commit_application_delivery_result($1,$2,'submitted',$3)", [id, user, receipt]);
    await db.query("SELECT commit_application_delivery_result($1,$2,'submitted',$3)", [id, user, receipt]);
    expect((await state(id)).delivery_status).toBe("submitted");
    expect((await db.query("SELECT count(*)::int AS count FROM application_events WHERE application_id=$1 AND to_status='submitted'", [id])).rows[0]).toMatchObject({ count: 1 });
  });
  it("rejects dry-run and self-reported receipts as worker-confirmed outcomes", async () => {
    const id = "a9999999-9999-4999-8999-999999999999";
    await packet(id); await transition(id, "queued"); await transition(id, "submitting");
    for (const receipt of [
      { receiptId: "contractor-confirmed-test", mode: "external_handoff" },
      { receiptId: "DRY-test", mode: "dry_run" },
      { receiptId: "mock-ats-test", mode: "dry_run" },
    ]) {
      await expect(db.query("SELECT commit_application_delivery_result($1,$2,'submitted',$3)", [id, user,
        JSON.stringify({ ...receipt, destination: "https://mock.example.test/apply", createdAt: new Date().toISOString() })])).rejects.toThrow(/confirmation receipt/);
      expect((await state(id)).delivery_status).toBe("submitting");
    }
  });
  it("backfills contractor reports conservatively without deleting their original history", async () => {
    const id = "b9999999-9999-4999-8999-999999999999";
    const legacyReceipt = { receiptId: "contractor-confirmed-legacy", mode: "external_handoff", destination: "https://mock.example.test/apply" };
    const legacy = await createTestLifecycleDb(async (before) => {
      await before.query("INSERT INTO auth.users VALUES($1)", [user]);
      await before.query(`INSERT INTO application_packets(id,user_id,job_snapshot,status,mode,idempotency_key,receipt)
        VALUES($1::uuid,$2,'{}','applied','external_handoff',$1::text,$3)`, [id, user, JSON.stringify(legacyReceipt)]);
    });
    try {
      expect((await legacy.query("SELECT delivery_status,receipt FROM application_packets WHERE id=$1", [id])).rows[0])
        .toMatchObject({ delivery_status: "needs_info", receipt: legacyReceipt });
    } finally { await legacy.close(); }
  }, 30_000);
  it("does not reuse attempt IDs across explicit Retry or reclaim an unknown outcome", async () => {
    const id = "a8888888-8888-4888-8888-888888888888";
    await packet(id);
    await db.query(`INSERT INTO application_worker_tasks(user_id,application_id,idempotency_key,destination,callback_url)
      VALUES($1,$2::uuid,$2::text,'https://mock.example.test/apply','https://mock.example.test/callback')`, [user, id]);
    const first = await db.query<{ id: string; attempts: number }>("SELECT * FROM claim_application_delivery_task('railway-test',$1)", [id]);
    expect(first.rows[0].attempts).toBe(1);
    await db.query("UPDATE application_worker_tasks SET lease_expires_at=now()-interval '1 minute' WHERE application_id=$1", [id]);
    expect((await db.query("SELECT * FROM claim_application_delivery_task('railway-test',$1)", [id])).rows).toHaveLength(0);
    await db.query("UPDATE application_worker_tasks SET status='failed',last_error='worker_crash' WHERE application_id=$1", [id]);
    await transition(id, "queued", null, true);
    await db.query("UPDATE application_worker_tasks SET status='queued',attempts=0 WHERE application_id=$1", [id]);
    const second = await db.query<{ attempts: number; attempt_base: number }>("SELECT * FROM claim_application_delivery_task('railway-test',$1)", [id]);
    expect(second.rows[0]).toMatchObject({ attempts: 2, attempt_base: 1 });
    const ignored = await db.query<{ result: { duplicate: boolean } }>(`SELECT commit_application_delivery_result($1,$2,'failed','{}',NULL,true,'worker_crash',NULL,$3,1) AS result`, [id, user, first.rows[0].id]);
    expect(ignored.rows[0].result.duplicate).toBe(true);
    expect((await state(id)).delivery_status).toBe("submitting");
  });
  it("backfills only unresolved aggregators, preserving resolved ATS, question and profile gates", async () => {
    const ids = ["c1111111-1111-4111-8111-111111111111", "c2222222-2222-4222-8222-222222222222",
      "c3333333-3333-4333-8333-333333333333", "c4444444-4444-4444-8444-444444444444"];
    const legacy = await createTestLifecycleDb(async before => {
      await before.query("INSERT INTO auth.users VALUES($1)", [user]);
      for (const [index, id] of ids.entries()) {
        await before.query(`INSERT INTO application_packets(id,user_id,job_snapshot,status,idempotency_key)
          VALUES($1::uuid,$2,'{}','needs_review',$1::text)`, [id, user]);
        await before.query(`INSERT INTO application_worker_tasks(user_id,application_id,idempotency_key,destination,callback_url,status)
          VALUES($1,$2::uuid,$2::text,'https://www.adzuna.co.uk/jobs/details/123','https://mock.example.test/callback','needs_user')`, [user, id]);
        const receipt = { state: "needs_user", action: index === 3 ? "/profile" : "employer_login",
          destination: index === 1 ? "https://mock.example.test/apply" : "https://www.adzuna.co.uk/jobs/details/123",
          review: { questions: index === 2 ? [{ id: "rate", label: "Day rate?", required: true }] : [] } };
        await before.query(`INSERT INTO application_submissions(user_id,application_id,provider_name,idempotency_key,payload_hash,status,receipt)
          VALUES($1,$2::uuid,'mock',$2::text,'fixture','processing',$3)`, [user, id, JSON.stringify(receipt)]);
      }
    });
    try {
      const rows = await legacy.query<{ id: string; delivery_status: string }>(
        "SELECT id,delivery_status FROM application_packets ORDER BY id");
      expect(rows.rows.map(row => row.delivery_status)).toEqual(["external_only", "needs_info", "needs_info", "needs_info"]);
    } finally { await legacy.close(); }
  }, 30_000);
});
describe("shared lifecycle contract", () => {
  it("matches the forward-only and explicit-retry rules", () => {
    expect(canTransitionDelivery("submitting", "awaiting_approval")).toBe(false);
    expect(canTransitionDelivery("submitted", "queued", true)).toBe(false);
    expect(canTransitionDelivery("failed", "queued", true)).toBe(true);
    expect(canTransitionDelivery("external_only", "queued")).toBe(false);
  });
  it("only identifies actual Adzuna/Reed hosts, not lookalikes", () => {
    expect(isUnresolvedAggregator("https://www.adzuna.co.uk/jobs/details/123")).toBe(true);
    expect(isUnresolvedAggregator("https://www.reed.co.uk/jobs/example")).toBe(true);
    expect(isUnresolvedAggregator("https://reed.co.uk.evil.test/")).toBe(false);
  });
});
