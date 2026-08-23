import { describe, expect, it } from "vitest";
import {
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
});
