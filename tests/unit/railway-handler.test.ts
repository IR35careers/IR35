import { describe, expect, it, vi } from "vitest";
import { handleRailwayApplication, LeaseDeferred } from "../../services/application-worker/railway-handler";
import type { ApplicationWorkerAssignment } from "@/lib/application-worker-types";
import { shouldAutomaticallyRetryWorkerAttention } from "@/lib/application-worker-retry";

const applicationId = "2344d4ef-4afd-42c3-b4f0-979e671e81a7";
function fixture() {
  const task: ApplicationWorkerAssignment["task"] = {
    id: "3344d4ef-4afd-42c3-b4f0-979e671e81a7", user_id: "4344d4ef-4afd-42c3-b4f0-979e671e81a7",
    application_id: applicationId, idempotency_key: `submit:${applicationId}`,
    destination: "https://mock-ats.example.test/apply", callback_url: "https://www.ir35careers.com/api/applications/worker/callback", status: "running", attempts: 1,
  };
  const result = { taskId: task.id, userId: task.user_id, applicationId, idempotencyKey: task.idempotency_key,
    completedAt: new Date().toISOString(), receipt: { state: "submitted" as const, providerSubmissionId: "mock-receipt", submittedAt: new Date().toISOString(), message: "Mock submission received" } };
  return {
    data: { kickId: task.id, applicationId, reason: "test", requestedAt: new Date().toISOString() },
    signal: new AbortController().signal, workerId: "railway-test", startedAt: new Date().toISOString(), version: "test",
    claim: vi.fn().mockResolvedValue({ task }), pending: vi.fn().mockResolvedValue({ status: "queued", available_at: null, lease_expires_at: null }),
    execute: vi.fn().mockResolvedValue(result), callback: vi.fn().mockResolvedValue({ ok: true }),
  };
}
describe("Railway application handoff", () => {
  it("caps Railway employer attempts at the initial try plus two retries", () => {
    expect(shouldAutomaticallyRetryWorkerAttention({ action: "runner_timeout", attempts: 2, maximumAttempts: 3 })).toBe(true);
    expect(shouldAutomaticallyRetryWorkerAttention({ action: "runner_timeout", attempts: 3, maximumAttempts: 3 })).toBe(false);
    expect(shouldAutomaticallyRetryWorkerAttention({ action: "captcha", attempts: 1, maximumAttempts: 3 })).toBe(false);
  });
  it("claims only the requested application and persists the mock receipt", async () => {
    const input = fixture();
    await expect(handleRailwayApplication(input)).resolves.toEqual({ state: "submitted" });
    expect(input.claim).toHaveBeenCalledWith(expect.objectContaining({ preferredApplicationId: applicationId }));
    expect(input.execute).toHaveBeenCalledOnce(); expect(input.callback).toHaveBeenCalledOnce();
  });
  it("retries a lost callback ack with the same result, not a second browser", async () => {
    const input = fixture(); input.callback.mockRejectedValueOnce(new Error("Lost ack"));
    await expect(handleRailwayApplication(input)).resolves.toEqual({ state: "submitted" });
    expect(input.execute).toHaveBeenCalledOnce(); expect(input.callback).toHaveBeenCalledTimes(2);
    expect(input.callback.mock.calls[0][1]).toBe(input.callback.mock.calls[1][1]);
  });
  it("will not replay a crashed or still-running employer attempt", async () => {
    const input = fixture(); input.pending.mockResolvedValue({ status: "running", lease_expires_at: "2020-01-01T00:00:00Z", available_at: null });
    await expect(handleRailwayApplication(input)).rejects.toBeInstanceOf(LeaseDeferred);
    expect(input.claim).not.toHaveBeenCalled(); expect(input.execute).not.toHaveBeenCalled();
  });
  it("a duplicate message after completion cannot submit twice", async () => {
    const input = fixture(); input.pending.mockResolvedValue({ status: "completed" });
    await expect(handleRailwayApplication(input)).resolves.toEqual({ state: "idle" });
    expect(input.execute).not.toHaveBeenCalled();
  });
  it("rejects malformed messages, mismatched assignments and cancellation", async () => {
    const malformed = fixture(); malformed.data.applicationId = "invalid";
    await expect(handleRailwayApplication(malformed)).rejects.toThrow(); expect(malformed.claim).not.toHaveBeenCalled();
    const wrong = fixture(); wrong.claim.mockResolvedValue({ task: { ...(await wrong.claim()).task, application_id: "5344d4ef-4afd-42c3-b4f0-979e671e81a7" } });
    await expect(handleRailwayApplication(wrong)).rejects.toThrow("does not match"); expect(wrong.execute).not.toHaveBeenCalled();
    const cancelled = fixture(); cancelled.signal = AbortSignal.abort();
    await expect(handleRailwayApplication(cancelled)).rejects.toThrow(); expect(cancelled.claim).not.toHaveBeenCalled();
  });
  it("reports failed persistence without re-executing the employer form", async () => {
    const input = fixture(); input.callback.mockRejectedValue(new Error("outage"));
    await expect(handleRailwayApplication(input)).rejects.toThrow("confirmation is unknown");
    expect(input.execute).toHaveBeenCalledOnce(); expect(input.callback).toHaveBeenCalledTimes(3);
  });
});
