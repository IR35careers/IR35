import { describe, expect, it } from "vitest";
import {
  shouldRequestVerificationRetry,
  verificationRecoveryDue,
  verificationRecoveryRequestedAfter,
} from "@/lib/email/recover-pending-verifications";

describe("pending verification recovery policy", () => {
  const now = Date.parse("2026-08-23T06:00:00.000Z");

  it("checks a pending employer inbox no more than once per minute", () => {
    expect(
      verificationRecoveryDue("2026-08-23T05:59:30.000Z", now),
    ).toBe(false);
    expect(
      verificationRecoveryDue("2026-08-23T05:58:59.000Z", now),
    ).toBe(true);
  });

  it("recovers messages from an application-scoped 24 hour window", () => {
    expect(
      verificationRecoveryRequestedAfter(
        "2026-08-23T02:26:00.000Z",
        now,
      ),
    ).toBe("2026-08-23T02:11:00.000Z");
    expect(
      verificationRecoveryRequestedAfter(
        "2026-08-21T02:26:00.000Z",
        now,
      ),
    ).toBe("2026-08-22T06:00:00.000Z");
  });

  it("requests at most two fresh codes with a 30 minute gap", () => {
    expect(shouldRequestVerificationRetry({ retryCount: 0, nowMs: now })).toBe(
      true,
    );
    expect(
      shouldRequestVerificationRetry({
        retryCount: 1,
        lastRequestedAt: "2026-08-23T05:45:00.000Z",
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      shouldRequestVerificationRetry({
        retryCount: 1,
        lastRequestedAt: "2026-08-23T05:29:00.000Z",
        nowMs: now,
      }),
    ).toBe(true);
    expect(shouldRequestVerificationRetry({ retryCount: 2, nowMs: now })).toBe(
      false,
    );
  });
});
