import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { transitionDelivery, commitDeliveryResult } from "@/lib/application-lifecycle-server";
import { canRetryDelivery, applicationDeliveryStatusSchema } from "@/lib/application-lifecycle";
import { readTextBody, RequestBodyError } from "@/lib/security/request-body";
import { STAGING_TEST_ACCOUNT } from "./mock-config";
import { MOCK_WEB_CLAIM_PATH, MOCK_WEB_CALLBACK_PATH, verifyMockWebSignature } from "./mock-web-http";
import { mockWebPolicy, requireMockWebActor, mockWebClaimOrHeartbeatSchema, mockWebResultSchema,
  mockWebAssignmentSchema, type MockWebPolicy, type MockWebKick } from "./mock-web-policy";
import { publishMockWebApplication } from "./mock-web-producer";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" };
export class MockRequestError extends Error {
  constructor(readonly status: number) { super("The isolated mock request was rejected; no submission is confirmed."); }
}
const packetSchema = z.object({ id: z.uuid(), user_id: z.uuid(), job_id: z.uuid(),
  delivery_status: applicationDeliveryStatusSchema, delivery_version: z.number().int().positive(),
  truth_approved: z.boolean(), materials_approved: z.boolean(), submission_approved: z.boolean(),
  screening_answers: z.array(z.object({ required: z.boolean(), reviewed: z.boolean(), answer: z.string() })),
});
type Packet = z.infer<typeof packetSchema>;
const taskSchema = z.object({ id: z.uuid(), user_id: z.uuid(), application_id: z.uuid(),
  status: z.enum(["queued", "running", "completed", "failed", "needs_user", "cancelled"]),
  attempts: z.number().int().nonnegative(), destination: z.string(), lease_owner: z.string().nullable(),
});
const PACKET_FIELDS = "id,user_id,job_id,delivery_status,delivery_version,truth_approved,materials_approved,submission_approved,screening_answers";
const TASK_FIELDS = "id,user_id,application_id,status,attempts,destination,lease_owner";

/** Bad/missing mock config MUST NOT fall through into the real provider path. */
export function isMockWebMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.APPLY_RUNNER === "mock" || (env.IR35_MOCK_WEB_ENABLED !== undefined && env.IR35_MOCK_WEB_ENABLED !== "false");
}
export function requireMockWebPolicy(env: Record<string, string | undefined> = process.env): MockWebPolicy {
  try { const policy = mockWebPolicy(env); if (policy) return policy; } catch { /* Fixed redacted error. */ }
  throw new MockRequestError(503);
}
export function requireMockWebAccount(email: unknown): void {
  if (email !== STAGING_TEST_ACCOUNT) throw new MockRequestError(403);
}
function approved(packet: Packet): boolean {
  return packet.truth_approved && packet.materials_approved && packet.submission_approved
    && packet.screening_answers.every(item => !item.required || (item.reviewed && Boolean(item.answer.trim())));
}
function destination(policy: MockWebPolicy, jobId: string): string {
  return `https://mock-ats.invalid/${policy.scenarioFor(jobId)}`;
}

/** Check the SERVER job, not a user-supplied snapshot/destination. This also
 * runs before saveApprovedPacket, so an unowned job causes no packet writes.
 */
export async function requireMockWebJob(admin: SupabaseClient, policy: MockWebPolicy, jobId: unknown): Promise<string> {
  const id = z.uuid().safeParse(jobId);
  if (!id.success || !policy.jobIds.includes(id.data)) throw new MockRequestError(403);
  const result = await admin.from("jobs").select("id,apply_url").eq("id", id.data).maybeSingle();
  if (result.error || result.data?.id !== id.data || result.data?.apply_url !== destination(policy, id.data))
    throw new MockRequestError(403);
  return id.data;
}
async function packetFor(admin: SupabaseClient, policy: MockWebPolicy, applicationId: string, userId?: string) {
  let query = admin.from("application_packets").select(PACKET_FIELDS).eq("id", applicationId);
  if (userId) query = query.eq("user_id", userId);
  const result = await query.maybeSingle();
  const parsed = packetSchema.safeParse(result.data);
  if (result.error || !parsed.success) throw new MockRequestError(404);
  const packet = parsed.data;
  const account = await admin.auth.admin.getUserById(packet.user_id);
  if (account.error) throw new MockRequestError(403);
  requireMockWebActor(policy, { accountEmail: account.data.user?.email, userId: userId ?? packet.user_id,
    packetUserId: packet.user_id, applicationId: packet.id, jobId: packet.job_id });
  await requireMockWebJob(admin, policy, packet.job_id);
  return packet;
}
async function taskFor(admin: SupabaseClient, packet: Packet) {
  const result = await admin.from("application_worker_tasks").select(TASK_FIELDS)
    .eq("application_id", packet.id).eq("user_id", packet.user_id).maybeSingle();
  if (result.error) throw new MockRequestError(503);
  if (!result.data) return null;
  const parsed = taskSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.application_id !== packet.id || parsed.data.user_id !== packet.user_id)
    throw new MockRequestError(409);
  return parsed.data;
}

/** Never call the global watchdog on a copied customer dataset. Only the six
 * server-owned fixture jobs AND the exact named account can be mutated.
 */
async function failStuckMockFixtures(admin: SupabaseClient, policy: MockWebPolicy): Promise<number> {
  const pending = await admin.from("application_packets").select("id,user_id")
    .in("job_id", [...policy.jobIds]).in("delivery_status", ["queued", "submitting"])
    .lt("updated_at", new Date(Date.now() - 600_000).toISOString()).limit(100);
  if (pending.error) throw new MockRequestError(503);
  let failed = 0;
  for (const row of pending.data ?? []) {
    const candidate = z.object({ id: z.uuid(), user_id: z.uuid() }).parse(row);
    const account = await admin.auth.admin.getUserById(candidate.user_id);
    if (account.error) throw new MockRequestError(503);
    if (account.data.user?.email !== STAGING_TEST_ACCOUNT) continue;
    const packet = await packetFor(admin, policy, candidate.id, candidate.user_id);
    if (packet.delivery_status !== "queued" && packet.delivery_status !== "submitting") continue;
    const task = await taskFor(admin, packet);
    if (task && task.destination !== destination(policy, packet.job_id)) throw new MockRequestError(409);
    await commitDeliveryResult(admin, { applicationId: packet.id, userId: packet.user_id, status: "failed",
      receipt: { state: "failed", mockOnly: true }, reason: "runner_timeout",
      detail: "The isolated mock worker did not confirm an outcome within ten minutes. No employer was contacted.",
      ...(task ? { taskId: task.id, attempt: task.attempts } : {}) });
    failed++;
  }
  return failed;
}

/** Same persisted app lifecycle/RPCs as the UI, separate durable opaque queue.
 * No provider/email/alias/PDF/CV/callback URL is built or invoked here.
 */
export async function submitMockWebApplication(input: {
  admin: SupabaseClient; policy: MockWebPolicy; applicationId: string; userId: string; retry: boolean;
  publish?: (value: MockWebKick) => Promise<void>;
}): Promise<Response> {
  const { admin, policy } = input;
  let packet = await packetFor(admin, policy, input.applicationId, input.userId);
  if (packet.delivery_status === "submitted") return Response.json({ state: "submitted", duplicate: true, mockOnly: true }, { headers: HEADERS });
  if (packet.delivery_status === "submitting") return Response.json({ state: "processing", deliveryStatus: "submitting", duplicate: true, mockOnly: true }, { status: 202, headers: HEADERS });
  if (!approved(packet) || packet.delivery_status === "skipped"
    || (canRetryDelivery(packet.delivery_status) && !input.retry)) throw new MockRequestError(409);
  const initialTask = await taskFor(admin, packet);
  if (initialTask && initialTask.destination !== destination(policy, packet.job_id)) throw new MockRequestError(409);
  packet = packetSchema.parse(await transitionDelivery(admin, { applicationId: packet.id, userId: packet.user_id,
    status: "queued", explicitRetry: canRetryDelivery(packet.delivery_status) && input.retry }));
  const key = `submit:${packet.id}`;
  const now = new Date().toISOString();
  // Insert once. A duplicate click cannot reset a running or completed lease.
  const saved = await admin.from("application_submissions").upsert({
    user_id: packet.user_id, application_id: packet.id, provider_name: "ISOLATED STAGING MOCK — NOT AN EMPLOYER",
    idempotency_key: key, payload_hash: createHash("sha256").update(`${packet.id}:${packet.job_id}`).digest("hex"),
    status: "processing", receipt: { state: "processing", mockOnly: true }, updated_at: now,
  }, { onConflict: "user_id,idempotency_key", ignoreDuplicates: true });
  if (saved.error) throw new MockRequestError(503);
  let task = initialTask;
  if (!task) {
    const inserted = await admin.from("application_worker_tasks").upsert({ user_id: packet.user_id, application_id: packet.id,
      idempotency_key: key, destination: destination(policy, packet.job_id), callback_url: "https://staging.ir35careers.com/api/applications/worker/callback",
      status: "queued", attempts: 0, available_at: now,
    }, { onConflict: "user_id,idempotency_key", ignoreDuplicates: true });
    if (inserted.error) throw new MockRequestError(503);
  } else if (["failed", "needs_user", "cancelled"].includes(task.status) && input.retry) {
    // CAS against the retained terminal attempt. Never reset attempts, never
    // overwrite a lease that another request has already queued/claimed.
    const reset = await admin.from("application_worker_tasks").update({ status: "queued", available_at: now,
      lease_owner: null, lease_expires_at: null, last_error: null, completed_at: null, updated_at: now })
      .eq("id", task.id).eq("user_id", packet.user_id).eq("status", task.status).eq("attempts", task.attempts);
    if (reset.error) throw new MockRequestError(503);
  }
  task = await taskFor(admin, packet);
  if (!task || task.destination !== destination(policy, packet.job_id)) throw new MockRequestError(503);
  if (task.status === "running") return Response.json({ state: "processing", deliveryStatus: "submitting", duplicate: true, mockOnly: true }, { status: 202, headers: HEADERS });
  if (task.status !== "queued") throw new MockRequestError(409);
  try {
    await (input.publish ?? publishMockWebApplication)({ kind: "staging_web_mock_delivery", applicationId: packet.id,
      jobId: packet.job_id, deliveryVersion: packet.delivery_version, requestedAt: now });
  } catch {
    // If claim won the race, SQL's exact attempt guard rejects this old outcome.
    // Otherwise the failure is visible, never silently returned to Ready.
    await commitDeliveryResult(admin, { applicationId: packet.id, userId: packet.user_id, status: "failed",
      receipt: { mockOnly: true, state: "failed" }, reason: "mock_queue_unavailable",
      detail: "The isolated mock queue did not acknowledge delivery. No submission is confirmed.", taskId: task.id, attempt: task.attempts });
    throw new MockRequestError(503);
  }
  return Response.json({ state: "processing", deliveryStatus: "queued", mockOnly: true }, { status: 202, headers: HEADERS });
}

/** Called BEFORE the normal handler's heartbeat/recovery/mail/profile logic. */
export async function handleMockWebControl(request: Request, kind: "claim" | "callback", createAdmin: () => SupabaseClient,
  env: Record<string, string | undefined> = process.env): Promise<Response> {
  try {
    const policy = requireMockWebPolicy(env);
    const path = kind === "claim" ? MOCK_WEB_CLAIM_PATH : MOCK_WEB_CALLBACK_PATH;
    if (new URL(request.url).pathname !== path) throw new MockRequestError(400);
    const raw = await readTextBody(request, 16_384);
    if (!verifyMockWebSignature({ secret: env.APPLICATION_WORKER_SECRET!, method: request.method, path, body: raw,
      timestamp: request.headers.get("x-ir35-web-mock-timestamp"), signature: request.headers.get("x-ir35-web-mock-signature") })) throw new MockRequestError(401);
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw new MockRequestError(400); }
    const parsed = (kind === "claim" ? mockWebClaimOrHeartbeatSchema : mockWebResultSchema).safeParse(json);
    if (!parsed.success) throw new MockRequestError(400);
    const admin = createAdmin();
    if (parsed.data.kind === "staging_web_mock_heartbeat") {
      const heartbeat = parsed.data;
      const saved = await admin.from("application_worker_heartbeats").upsert({ worker_id: heartbeat.workerId,
        last_seen_at: new Date().toISOString(), started_at: heartbeat.startedAt, active: heartbeat.active,
        concurrency: 1, completed: heartbeat.completed, failed: heartbeat.failed, version: heartbeat.buildSha });
      if (saved.error) throw new MockRequestError(503);
      const timedOut = await failStuckMockFixtures(admin, policy);
      return Response.json({ ok: true, timedOut }, { headers: HEADERS });
    }
    if (parsed.data.kind === "staging_web_mock_claim") {
      const claim = parsed.data;
      const packet = await packetFor(admin, policy, claim.applicationId);
      if (packet.job_id !== claim.jobId) throw new MockRequestError(403);
      // Lost claim ACK: the SAME persisted worker identity can retrieve its
      // already-held lease, but never reclaim it or increment the attempt.
      if (claim.recoverLease === true && packet.delivery_status === "submitting") {
        const held = await taskFor(admin, packet);
        if (held?.status === "running" && held.lease_owner === claim.workerId && held.destination === destination(policy, packet.job_id))
          return Response.json({ assignment: mockWebAssignmentSchema.parse({ applicationId: packet.id, taskId: held.id,
            attempt: held.attempts, scenario: policy.scenarioFor(packet.job_id) }) }, { headers: HEADERS });
      }
      if (packet.delivery_status !== "queued" || packet.delivery_version !== claim.deliveryVersion)
        return Response.json({ assignment: null }, { headers: HEADERS });
      if (!approved(packet)) throw new MockRequestError(409);
      const pending = await taskFor(admin, packet);
      if (!pending || pending.status !== "queued" || pending.destination !== destination(policy, packet.job_id))
        return Response.json({ assignment: null }, { headers: HEADERS });
      const claimed = await admin.rpc("claim_application_delivery_task", { p_worker_id: claim.workerId, p_application_id: packet.id });
      if (claimed.error) throw new MockRequestError(503);
      const row: unknown = Array.isArray(claimed.data) ? claimed.data[0] : claimed.data;
      if (!row) return Response.json({ assignment: null }, { headers: HEADERS });
      const task = taskSchema.parse(row);
      if (task.id !== pending.id || task.application_id !== packet.id || task.user_id !== packet.user_id
        || task.status !== "running" || task.lease_owner !== claim.workerId
        || task.destination !== destination(policy, packet.job_id)) throw new MockRequestError(409);
      return Response.json({ assignment: mockWebAssignmentSchema.parse({ applicationId: packet.id, taskId: task.id,
        attempt: task.attempts, scenario: policy.scenarioFor(packet.job_id) }) }, { headers: HEADERS });
    }
    const result = parsed.data;
    const packet = await packetFor(admin, policy, result.applicationId);
    const task = await taskFor(admin, packet);
    if (!task || task.id !== result.taskId || task.destination !== destination(policy, packet.job_id)) throw new MockRequestError(409);
    if (task.status !== "running" || task.attempts !== result.attempt)
      return Response.json({ ok: true, duplicate: true }, { headers: HEADERS });
    if (!task.lease_owner?.startsWith("staging-web-mock-") || packet.delivery_status !== "submitting") throw new MockRequestError(409);
    await commitDeliveryResult(admin, { applicationId: packet.id, userId: packet.user_id, status: result.outcome,
      receipt: { state: result.outcome, mockOnly: true, provider: "ISOLATED STAGING MOCK — NOT AN EMPLOYER",
        receiptId: `staging-mock-${task.id}-${task.attempts}`, destination: destination(policy, packet.job_id), createdAt: new Date().toISOString() },
      reason: result.failure, detail: result.failure ? "Isolated mock ATS did not confirm submission. No employer was contacted." : null,
      taskId: task.id, attempt: task.attempts });
    return Response.json({ ok: true }, { headers: HEADERS });
  } catch (error) {
    const status = error instanceof MockRequestError ? error.status : error instanceof RequestBodyError ? error.status : 503;
    return Response.json({ error: "The isolated mock control request was rejected; no submission is confirmed." }, { status, headers: HEADERS });
  }
}
