import { describe, expect, it } from "vitest";
import {
  APPLICATION_WORKER_MAX_ATTEMPTS,
  applicationWorkerCallbackErrorStatus,
  applicationWorkerRetryDelayMs,
  shouldAutomaticallyRetryWorkerAttention,
} from "@/lib/application-worker-retry";

describe("application worker retry policy", () => {
  it("keeps callback errors recoverable instead of marking them failed", () => {
    expect(applicationWorkerCallbackErrorStatus()).toBe("needs_user");
  });

  it("retries delayed verification mail without asking the user", () => {
    expect(
      shouldAutomaticallyRetryWorkerAttention({
        action: "verification_code",
        attempts: 1,
      }),
    ).toBe(true);
    expect(
      shouldAutomaticallyRetryWorkerAttention({
        action: "verification_code",
        attempts: APPLICATION_WORKER_MAX_ATTEMPTS - 1,
      }),
    ).toBe(true);
    expect(
      shouldAutomaticallyRetryWorkerAttention({
        action: "verification_link",
        attempts: 1,
      }),
    ).toBe(true);
    expect(
      shouldAutomaticallyRetryWorkerAttention({
        action: "account_recovery_email",
        attempts: 1,
      }),
    ).toBe(true);
  });

  it("retries transient portal and source interruptions without an extension", () => {
    for (const action of [
      "browser_continue",
      "source_access_denied",
      "runner_timeout",
    ]) {
      expect(
        shouldAutomaticallyRetryWorkerAttention({ action, attempts: 1 }),
      ).toBe(true);
    }
  });

  it("stops after the controlled retry limit", () => {
    expect(
      shouldAutomaticallyRetryWorkerAttention({
        action: "verification_code",
        attempts: APPLICATION_WORKER_MAX_ATTEMPTS,
      }),
    ).toBe(false);
    expect(
      shouldAutomaticallyRetryWorkerAttention({
        action: "account_recovery_email",
        attempts: APPLICATION_WORKER_MAX_ATTEMPTS,
      }),
    ).toBe(false);
  });

  it("does not retry legal consent or security actions", () => {
    expect(
      shouldAutomaticallyRetryWorkerAttention({
        action: "employer_terms",
        attempts: 1,
      }),
    ).toBe(false);
    expect(
      shouldAutomaticallyRetryWorkerAttention({
        action: "captcha",
        attempts: 1,
      }),
    ).toBe(false);
  });

  it("backs off verification retries up to four minutes", () => {
    expect(applicationWorkerRetryDelayMs(1)).toBe(60_000);
    expect(applicationWorkerRetryDelayMs(2)).toBe(120_000);
    expect(applicationWorkerRetryDelayMs(10)).toBe(240_000);
  });
});
