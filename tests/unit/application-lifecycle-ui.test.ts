import { describe, expect, it } from "vitest";
import { mapCloudApplication } from "@/lib/workspace/repository";
import { hasActiveSubmission } from "@/lib/application-submission-state";
import { DEMO_JOBS } from "@/lib/demo-jobs";

describe("stored delivery state on reload", () => {
  const row = { id: "a1111111-1111-4111-8111-111111111111", job_snapshot: DEMO_JOBS[0],
    status: "ready", delivery_status: "submitting", delivery_version: 3, failure_reason: null,
    error_detail: null, created_at: "2026-10-15T05:59:00Z", updated_at: "2026-10-15T06:00:00Z" };
  it("retains submitting even when the browser-only started event was never saved", () => {
    const loaded = mapCloudApplication(row, []);
    expect(hasActiveSubmission(loaded.status, loaded.events, loaded.attention, loaded.deliveryStatus)).toBe(true);
    expect(loaded.deliveryStatus).toBe("submitting");
  });
  it("retains the actual failure instead of recomputing Ready from approvals", () => {
    const loaded = mapCloudApplication({ ...row, status: "failed", delivery_status: "failed",
      truth_approved: true, materials_approved: true, submission_approved: true,
      failure_reason: "runner_timeout", error_detail: "The worker stopped before confirmation." }, []);
    expect(loaded.failureReason).toBe("runner_timeout");
    expect(loaded.deliveryStatus).toBe("failed");
    expect(hasActiveSubmission(loaded.status, loaded.events, loaded.attention, loaded.deliveryStatus)).toBe(false);
  });
  it("fails closed when a row has no installed authoritative lifecycle", () => {
    expect(() => mapCloudApplication({ ...row, delivery_status: undefined }, [])).toThrow();
  });
});
