import { describe, expect, it } from "vitest";
import {
  isStaleSubmissionLock,
  submissionLockAgeMs,
  submissionRetryAfterSeconds,
} from "@/lib/application-submission-state";

describe("application submission processing locks", () => {
  const now = Date.parse("2026-08-21T18:30:00.000Z");

  it("keeps a recent runner attempt locked to prevent duplicate applications", () => {
    const updatedAt = new Date(now - 60_000).toISOString();
    expect(isStaleSubmissionLock(updatedAt, now)).toBe(false);
    expect(submissionRetryAfterSeconds(updatedAt, now)).toBe(300);
  });

  it("recovers an attempt that outlived the maximum runner duration", () => {
    const updatedAt = new Date(now - 7 * 60_000).toISOString();
    expect(isStaleSubmissionLock(updatedAt, now)).toBe(true);
    expect(submissionRetryAfterSeconds(updatedAt, now)).toBe(1);
  });

  it("treats missing or invalid timestamps as stale", () => {
    expect(submissionLockAgeMs(null, now)).toBe(Number.POSITIVE_INFINITY);
    expect(isStaleSubmissionLock("not-a-date", now)).toBe(true);
  });
});
