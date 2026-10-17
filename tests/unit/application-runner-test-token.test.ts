import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationRunnerTestToken, verifyApplicationRunnerTestToken } from "@/lib/application-runner/test-token";

afterEach(() => vi.unstubAllEnvs());

describe("controlled application runner test tokens", () => {
  it("accepts a valid short-lived token", () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "a-strong-admin-session-secret-with-more-than-32-characters");
    const now = Date.UTC(2026, 7, 21, 10, 0, 0);
    const token = createApplicationRunnerTestToken(now);
    expect(verifyApplicationRunnerTestToken(token, now + 60_000)).toBe(true);
  });

  it("rejects expiry, tampering and missing configuration", () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "a-strong-admin-session-secret-with-more-than-32-characters");
    const now = Date.UTC(2026, 7, 21, 10, 0, 0);
    const token = createApplicationRunnerTestToken(now);
    expect(verifyApplicationRunnerTestToken(token, now + 5 * 60_000 + 1)).toBe(false);
    expect(verifyApplicationRunnerTestToken(`${token}x`, now)).toBe(false);
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    expect(() => createApplicationRunnerTestToken(now)).toThrow();
    expect(verifyApplicationRunnerTestToken(token, now)).toBe(false);
  });
});
