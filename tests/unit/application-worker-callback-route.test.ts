import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/applications/worker/callback/route";

const fixture = vi.hoisted(() => ({
  callback: {} as Record<string, unknown>, attempts: 1, approved: true,
  writes: [] as Array<{ table: string; data: Record<string, unknown> }>,
  kick: vi.fn(), needsUser: vi.fn(), submitted: vi.fn(),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/application-worker-auth", () => ({ applicationWorkerConfig: () => ({ enabled: true }) }));
vi.mock("@/lib/application-worker-request", () => ({
  readSignedApplicationWorkerJson: async () => fixture.callback,
  ApplicationWorkerRequestError: class extends Error {},
}));
vi.mock("@/lib/application-worker-kick", () => ({ kickApplicationWorker: fixture.kick }));
vi.mock("@/lib/application-portal-session", () => ({ clearPortalSession: vi.fn(), savePortalSession: vi.fn() }));
vi.mock("@/lib/email/inbox-alias", () => ({ ensureInboxAlias: async () => ({ forwardingEmail: "controlled@example.test" }) }));
vi.mock("@/lib/application-result-persistence", () => ({
  storeNeedsUser: fixture.needsUser, storeSubmittedApplication: fixture.submitted,
  providerReviewAction: (receipt: { review?: { action?: string } }) => receipt.review?.action,
}));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: () => ({
  auth: { admin: { getUserById: async () => ({ data: { user: { email: "controlled@example.test" } } }) } },
  from: (table: string) => {
    const chain = {
      select: () => chain, eq: () => chain,
      update: (data: Record<string, unknown>) => { fixture.writes.push({ table, data }); return chain; },
      upsert: (data: Record<string, unknown>) => { fixture.writes.push({ table, data }); return chain; },
      maybeSingle: async () => ({ error: null, data: table === "application_worker_tasks"
        ? { status: "running", attempts: fixture.attempts, destination: "https://employer.example.test/apply" }
        : table === "application_packets" ? {
          id: fixture.callback.applicationId, truth_approved: fixture.approved,
          materials_approved: fixture.approved, submission_approved: fixture.approved,
          screening_answers: [], source_cv_text: "Alex Morgan controlled resume",
          job_snapshot: { title: "Platform Engineer", company_name: "Controlled Employer" },
        } : { application_profile: { fullName: "Alex Morgan" } } }),
      then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return chain;
  },
}) }));

const base = () => ({
  taskId: "50bfbf67-bac9-4606-ab9d-020815496e6a",
  userId: "749495cc-f9f0-48c3-9a56-2af9a7139ec0",
  applicationId: "a497269d-d5df-423a-9ff5-f68250b94ea8",
  idempotencyKey: "submit:a497269d-d5df-423a-9ff5-f68250b94ea8",
  completedAt: new Date().toISOString(), workerAttempt: 1,
});
const request = () => new Request("https://www.ir35careers.com/api/applications/worker/callback", { method: "POST" });
const attentionReceipt = (action: string, questions: unknown[] = []) => ({
  state: "needs_user", providerSubmissionId: "", submittedAt: new Date().toISOString(),
  message: "Controlled attention outcome", review: { action, questions },
});

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("VERCEL", "1");
  fixture.writes = []; fixture.attempts = 1; fixture.approved = true;
  fixture.callback = { ...base(), error: "Browser launch connection failed", retryable: true };
  fixture.kick.mockResolvedValue("accepted");
});
afterEach(() => vi.unstubAllEnvs());

describe("cloud callback durable retry", () => {
  it("requeues a proven pre-submit error without asking the contractor or notifying them", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "processing" });
    expect(fixture.writes).toContainEqual({ table: "application_worker_tasks", data: expect.objectContaining({ status: "queued", lease_owner: null, completed_at: null }) });
    expect(fixture.writes).toContainEqual({ table: "application_packets", data: expect.objectContaining({ status: "ready" }) });
    expect(fixture.kick).toHaveBeenCalledWith(expect.objectContaining({ applicationId: base().applicationId, delaySeconds: 60 }));
    expect(fixture.needsUser).not.toHaveBeenCalled();
    expect(fixture.submitted).not.toHaveBeenCalled();
  });
  it("leaves the durable queued task intact when queue publication fails", async () => {
    fixture.kick.mockRejectedValue(new Error("Controlled publish outage"));
    expect((await POST(request())).status).toBe(500);
    expect(fixture.writes).toContainEqual({ table: "application_worker_tasks", data: expect.objectContaining({ status: "queued" }) });
    expect(fixture.needsUser).not.toHaveBeenCalled();
  });
  it("does not automatically replay an error with unknown submission boundaries", async () => {
    fixture.callback.retryable = false;
    expect(await (await POST(request())).json()).toMatchObject({ state: "needs_user" });
    expect(fixture.needsUser).toHaveBeenCalledOnce();
    expect(fixture.kick).not.toHaveBeenCalled();
  });
  it("retains the bounded attempt limit", async () => {
    fixture.attempts = 5; fixture.callback.workerAttempt = 5;
    expect(await (await POST(request())).json()).toMatchObject({ state: "needs_user" });
    expect(fixture.kick).not.toHaveBeenCalled();
  });
  it("asks the actual missing employer question instead of retrying the same empty form", async () => {
    fixture.callback = { ...base(), receipt: attentionReceipt("browser_continue", [{ id: "rate", label: "Expected day rate?", required: true }]) };
    expect(await (await POST(request())).json()).toMatchObject({ state: "needs_user" });
    expect(fixture.needsUser).toHaveBeenCalledWith(expect.objectContaining({ action: "browser_continue" }));
    expect(fixture.kick).not.toHaveBeenCalled();
  });
  it("does not replay a possibly accepted final employer action", async () => {
    fixture.callback = { ...base(), receipt: attentionReceipt("confirmation_pending") };
    expect(await (await POST(request())).json()).toMatchObject({ state: "needs_user" });
    expect(fixture.kick).not.toHaveBeenCalled();
    expect(fixture.submitted).not.toHaveBeenCalled();
  });
  it("does not queue more work after contractor approval is removed", async () => {
    fixture.approved = false;
    await POST(request());
    expect(fixture.kick).not.toHaveBeenCalled();
  });
  it("ignores a late callback from an earlier attempt", async () => {
    fixture.attempts = 2;
    expect(await (await POST(request())).json()).toEqual({ ok: true, duplicate: true });
    expect(fixture.writes).toEqual([]);
    expect(fixture.kick).not.toHaveBeenCalled();
  });
});
