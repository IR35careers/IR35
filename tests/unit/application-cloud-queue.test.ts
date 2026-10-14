import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationLeasePending, applicationQueueRetry, validApplicationCloudKick } from "@/lib/application-cloud-queue";
import { kickApplicationWorker } from "@/lib/application-worker-kick";

const queue = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@vercel/queue", () => ({ send: queue.send }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("device-independent cloud application delivery", () => {
  const applicationId = "2344d4ef-4afd-42c3-b4f0-979e671e81a7";
  const setup = () => {
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("APPLICATION_WORKER_ENABLED", "true");
    vi.stubEnv("APPLICATION_WORKER_SECRET", "worker-test-secret-that-is-long-enough-123");
  };
  it("publishes a delayed durable event containing IDs, not candidate evidence", async () => {
    setup(); queue.send.mockResolvedValue({ messageId: "queue-message" });
    await expect(kickApplicationWorker({ applicationId, reason: "verification_retry", delaySeconds: 120 })).resolves.toBe("accepted");
    const [topic, message, options] = queue.send.mock.calls[0];
    expect(topic).toBe("ir35-application-kicks");
    expect(validApplicationCloudKick(message)).toBe(true);
    expect(Object.keys(message).sort()).toEqual(["applicationId", "kickId", "reason", "requestedAt"]);
    expect(options).toMatchObject({ region: "iad1", retentionSeconds: 604800, delaySeconds: 120, idempotencyKey: message.kickId });
  });
  it("does not report accepted or fall back to a device when queue publication fails", async () => {
    setup(); queue.send.mockRejectedValue(new Error("publish failed"));
    await expect(kickApplicationWorker({ applicationId })).rejects.toThrow("publish failed");
  });
  it("retains messages until a live database lease can be reclaimed", () => {
    expect(applicationQueueRetry(new ApplicationLeasePending(360), 1)).toEqual({ afterSeconds: 360 });
    expect(applicationQueueRetry(new Error("temporary callback failure"), 8)).toEqual({ afterSeconds: 240 });
    expect(applicationQueueRetry(new Error("outage"), 99)).toEqual({ afterSeconds: 600 });
  });
  it("rejects malformed IDs and dates", () => {
    expect(validApplicationCloudKick({ kickId: applicationId, applicationId: "not-an-id", reason: "retry", requestedAt: new Date().toISOString() })).toBe(false);
    expect(validApplicationCloudKick({ kickId: applicationId, reason: "retry", requestedAt: "invalid" })).toBe(false);
  });
});
