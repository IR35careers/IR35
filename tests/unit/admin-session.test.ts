import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_SESSION_TTL_SECONDS, createAdminSession, verifyAdminSession } from "@/lib/admin-session";

afterEach(() => vi.unstubAllEnvs());

describe("short-lived admin sessions", () => {
  it("accepts a valid signed session and normalises its email", () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "a-strong-admin-session-secret-with-more-than-32-characters");
    const now = Date.UTC(2026, 7, 20, 12, 0, 0);
    const token = createAdminSession({ id: "user-1", email: " Admin@Example.com " }, now);
    expect(verifyAdminSession(token, now + 10_000)).toMatchObject({ sub: "user-1", email: "admin@example.com" });
  });

  it("rejects tampering and expiry", () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "a-strong-admin-session-secret-with-more-than-32-characters");
    const now = Date.UTC(2026, 7, 20, 12, 0, 0);
    const token = createAdminSession({ id: "user-1", email: "admin@example.com" }, now);
    expect(verifyAdminSession(`${token}x`, now)).toBeNull();
    expect(verifyAdminSession(token, now + ADMIN_SESSION_TTL_SECONDS * 1000 + 1)).toBeNull();
  });

  it("fails closed when the signing secret is missing or weak", () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "short");
    expect(() => createAdminSession({ id: "user-1", email: "admin@example.com" })).toThrow();
    expect(verifyAdminSession("invalid.token")).toBeNull();
  });
});
