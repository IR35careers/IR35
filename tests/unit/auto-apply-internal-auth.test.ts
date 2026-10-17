import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createScheduledAutoApplyAuthorization,
  verifyScheduledAutoApplyAuthorization,
} from "@/lib/automation/internal-auth";

describe("scheduled Auto Apply authorization", () => {
  const originalSecret = process.env.CRON_SECRET;
  const userId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    process.env.CRON_SECRET = "a-secure-cron-secret-with-more-than-32-characters";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("authorizes a current server-signed user run", () => {
    const now = 1_780_000_000_000;
    const authorization = createScheduledAutoApplyAuthorization({ userId, now });
    expect(authorization).not.toBeNull();
    expect(verifyScheduledAutoApplyAuthorization({
      userId,
      timestamp: authorization?.timestamp ?? "",
      suppliedSignature: authorization?.signature ?? "",
      now: now + 1_000,
    })).toBe(true);
  });

  it("rejects expired or user-swapped signatures", () => {
    const now = 1_780_000_000_000;
    const authorization = createScheduledAutoApplyAuthorization({ userId, now });
    expect(verifyScheduledAutoApplyAuthorization({
      userId,
      timestamp: authorization?.timestamp ?? "",
      suppliedSignature: authorization?.signature ?? "",
      now: now + 6 * 60_000,
    })).toBe(false);
    expect(verifyScheduledAutoApplyAuthorization({
      userId: "22222222-2222-4222-8222-222222222222",
      timestamp: authorization?.timestamp ?? "",
      suppliedSignature: authorization?.signature ?? "",
      now,
    })).toBe(false);
  });
});
