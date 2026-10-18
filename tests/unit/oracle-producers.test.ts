import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as ingest, POST as manualIngest } from "@/app/api/pipeline/fetch/route";
import { GET as automation } from "@/app/api/automation/run/route";
import { POST as legacyQueueCallback } from "@/app/api/queues/applications/route";
import { POST as drain } from "@/app/api/applications/worker/drain/route";
import { signApplicationWorkerBody } from "@/lib/application-worker-auth";

const fixture = vi.hoisted(() => ({ enqueue: vi.fn(), schedule: vi.fn(), pipeline: vi.fn(), automation: vi.fn(), browser: vi.fn(), verify: vi.fn(), kick: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/queue/producer", () => ({ enqueueRailwayApplication: fixture.enqueue, enqueueScheduledWork: fixture.schedule }));
vi.mock("@/lib/pipeline/run-fetch", () => ({ runFetchPipeline: fixture.pipeline }));
vi.mock("@/lib/automation/scheduled-runner", () => ({ runScheduledAutoApply: fixture.automation }));
vi.mock("@/lib/application-cloud-worker", () => ({ executeCloudApplication: fixture.browser }));
vi.mock("@/lib/application-cloud-verification", () => ({ verifyCloudApplicationRuntime: fixture.verify }));
vi.mock("@/lib/application-worker-kick", () => ({ kickApplicationWorker: fixture.kick }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: fixture.admin }));
vi.mock("@vercel/queue", () => ({ handleCallback: (callback: unknown) => callback }));

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APPLY_RUNNER", "oracle"); vi.stubEnv("VERCEL", "1");
  vi.stubEnv("CRON_SECRET", "controlled-cron-secret-not-live-123456789");
  vi.stubEnv("APPLICATION_WORKER_SECRET", "controlled-worker-secret-not-live-123456789");
  fixture.kick.mockResolvedValue("accepted"); fixture.enqueue.mockResolvedValue(undefined); fixture.schedule.mockResolvedValue(undefined);
  fixture.admin.mockImplementation(() => { throw new Error("No candidate database access is allowed in this producer test."); });
});
afterEach(() => vi.unstubAllEnvs());
const headers = () => ({ authorization: `Bearer ${process.env.CRON_SECRET}` });
function signed(path: string, payload: object) {
  const body = JSON.stringify(payload), signature = signApplicationWorkerBody(body);
  return new Request(`https://www.ir35careers.com${path}`, { method: "POST", body, headers: { "content-type": "application/json", "x-ir35-worker-timestamp": signature.timestamp, "x-ir35-worker-signature": signature.signature } });
}
function noExecution() {
  expect(fixture.pipeline).not.toHaveBeenCalled(); expect(fixture.automation).not.toHaveBeenCalled();
  expect(fixture.browser).not.toHaveBeenCalled(); expect(fixture.verify).not.toHaveBeenCalled(); expect(fixture.admin).not.toHaveBeenCalled();
}

describe.each(["oracle", "railway"])("%s routes only publish commands", runner => {
  beforeEach(() => vi.stubEnv("APPLY_RUNNER", runner));
  it("enqueues the ingestion cron without running ingestion in Vercel", async () => {
    const response = await ingest(new Request("https://www.ir35careers.com/api/pipeline/fetch", { headers: headers() }));
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ ok: true, state: "queued" });
    expect(fixture.schedule).toHaveBeenCalledExactlyOnceWith("ingest"); noExecution();
  });
  it("enqueues signed manual ingestion without executing it", async () => {
    const response = await manualIngest(signed("/api/pipeline/fetch", { action: "fetch_contract_jobs" }));
    expect(response.status).toBe(202); expect(fixture.schedule).toHaveBeenCalledExactlyOnceWith("ingest"); noExecution();
  });
  it("enqueues automation without running the scheduler or reconciliation in Vercel", async () => {
    const response = await automation(new Request("https://www.ir35careers.com/api/automation/run", { headers: headers() }));
    expect(response.status).toBe(202); expect(fixture.schedule).toHaveBeenCalledExactlyOnceWith("automation"); noExecution();
  });
  it("forwards a residual Vercel delivery to pg-boss, never another browser", async () => {
    const message = { kickId: "11111111-1111-4111-8111-111111111111", applicationId: "22222222-2222-4222-8222-222222222222", reason: "controlled_mock", requestedAt: new Date().toISOString() };
    await (legacyQueueCallback as unknown as (message: unknown) => Promise<void>)(message);
    expect(fixture.enqueue).toHaveBeenCalledExactlyOnceWith(message); noExecution();
  });
  it("the signed drain only publishes and identifies the selected queue host", async () => {
    const payload = { kickId: "11111111-1111-4111-8111-111111111111", applicationId: "22222222-2222-4222-8222-222222222222", reason: "controlled_mock", requestedAt: new Date().toISOString() };
    const response = await drain(signed("/api/applications/worker/drain", payload));
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ execution: `${runner}_pg_boss`, state: "accepted" });
    expect(fixture.kick).toHaveBeenCalledExactlyOnceWith({ applicationId: payload.applicationId, reason: "controlled_mock" }); noExecution();
  });
  it("retains cron and signed-request authentication", async () => {
    expect((await ingest(new Request("https://www.ir35careers.com/api/pipeline/fetch"))).status).toBe(401);
    expect((await automation(new Request("https://www.ir35careers.com/api/automation/run"))).status).toBe(401);
    expect((await manualIngest(new Request("https://www.ir35careers.com/api/pipeline/fetch", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))).status).toBe(401);
    expect(fixture.schedule).not.toHaveBeenCalled(); noExecution();
  });
});
