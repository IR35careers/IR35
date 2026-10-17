import { describe, expect, it } from "vitest";
import { validApplicationWorkerCallback } from "@/lib/application-worker-types";

const base = {
  taskId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  applicationId: "33333333-3333-4333-8333-333333333333",
  idempotencyKey: "submit:33333333-3333-4333-8333-333333333333",
  completedAt: "2026-08-23T12:00:00.000Z",
};

describe("application worker callback validation", () => {
  it("accepts a complete submitted receipt", () => {
    expect(validApplicationWorkerCallback({
      ...base,
      receipt: {
        state: "submitted",
        providerSubmissionId: "confirmation-123",
        submittedAt: "2026-08-23T12:00:00.000Z",
        message: "Application submitted.",
      },
    })).toBe(true);
  });

  it("rejects a callback for a different idempotency key", () => {
    expect(validApplicationWorkerCallback({
      ...base,
      idempotencyKey: "submit:44444444-4444-4444-8444-444444444444",
      error: "Worker stopped.",
    })).toBe(false);
  });

  it("accepts a bounded worker error", () => {
    expect(validApplicationWorkerCallback({
      ...base,
      error: "The approved application packet is no longer complete.",
    })).toBe(true);
  });
});
