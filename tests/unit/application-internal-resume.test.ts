import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApplicationResumeAuthorization,
  verifyApplicationResumeAuthorization,
} from "@/lib/application-internal-resume";

afterEach(() => vi.unstubAllEnvs());

describe("application verification resume authorization", () => {
  const applicationId = "00000000-0000-4000-8000-000000000001";
  const userId = "00000000-0000-4000-8000-000000000002";

  it("accepts a valid short-lived server authorization", () => {
    vi.stubEnv("CRON_SECRET", "a-strong-internal-automation-secret");
    const now = Date.UTC(2026, 7, 22, 12, 0, 0);
    const authorization = createApplicationResumeAuthorization({
      applicationId,
      userId,
      now,
    });
    expect(authorization).not.toBeNull();
    expect(
      verifyApplicationResumeAuthorization({
        applicationId,
        userId,
        timestamp: authorization?.timestamp ?? "",
        suppliedSignature: authorization?.signature ?? "",
        now: now + 60_000,
      }),
    ).toBe(true);
  });

  it("rejects expiry, tampering and a different user", () => {
    vi.stubEnv("CRON_SECRET", "a-strong-internal-automation-secret");
    const now = Date.UTC(2026, 7, 22, 12, 0, 0);
    const authorization = createApplicationResumeAuthorization({
      applicationId,
      userId,
      now,
    });
    expect(
      verifyApplicationResumeAuthorization({
        applicationId,
        userId,
        timestamp: authorization?.timestamp ?? "",
        suppliedSignature: `${authorization?.signature ?? ""}x`,
        now,
      }),
    ).toBe(false);
    expect(
      verifyApplicationResumeAuthorization({
        applicationId,
        userId: "00000000-0000-4000-8000-000000000003",
        timestamp: authorization?.timestamp ?? "",
        suppliedSignature: authorization?.signature ?? "",
        now,
      }),
    ).toBe(false);
    expect(
      verifyApplicationResumeAuthorization({
        applicationId,
        userId,
        timestamp: authorization?.timestamp ?? "",
        suppliedSignature: authorization?.signature ?? "",
        now: now + 5 * 60_000 + 1,
      }),
    ).toBe(false);
  });
});
