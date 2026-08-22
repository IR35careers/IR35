import { describe, expect, it } from "vitest";
import {
  hasActiveSubmission,
  isStaleSubmissionLock,
  latestSubmissionLifecycleEvent,
  submissionLockAgeMs,
  submissionRetryAfterSeconds,
} from "@/lib/application-submission-state";

describe("application submission processing locks", () => {
  const now = Date.parse("2026-08-21T18:30:00.000Z");

  it("keeps a recent runner attempt locked to prevent duplicate applications", () => {
    const updatedAt = new Date(now - 60_000).toISOString();
    expect(isStaleSubmissionLock(updatedAt, now)).toBe(false);
    expect(submissionRetryAfterSeconds(updatedAt, now)).toBe(90);
  });

  it("recovers an attempt that outlived the maximum runner duration", () => {
    const updatedAt = new Date(now - 3 * 60_000).toISOString();
    expect(isStaleSubmissionLock(updatedAt, now)).toBe(true);
    expect(submissionRetryAfterSeconds(updatedAt, now)).toBe(1);
  });

  it("treats missing or invalid timestamps as stale", () => {
    expect(submissionLockAgeMs(null, now)).toBe(Number.POSITIVE_INFINITY);
    expect(isStaleSubmissionLock("not-a-date", now)).toBe(true);
  });
});

describe("application submission client state", () => {
  it("treats only the latest lifecycle event as authoritative", () => {
    const events = [
      { label: "Application submission started" },
      { label: "Application attempt stopped and is ready to retry" },
    ];

    expect(latestSubmissionLifecycleEvent(events)?.label).toBe("Application attempt stopped and is ready to retry");
    expect(hasActiveSubmission("ready", events)).toBe(false);
  });

  it("keeps a newly started ready application in progress", () => {
    expect(hasActiveSubmission("ready", [{ label: "Application submission started" }])).toBe(true);
  });

  it("does not keep a submitted application in progress", () => {
    expect(hasActiveSubmission("applied", [{ label: "Application submission started" }])).toBe(false);
  });
});
