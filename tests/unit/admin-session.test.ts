import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_SESSION_TTL_SECONDS, createAdminSession, isAdminRequestHost, verifyAdminSession } from "@/lib/admin-session";

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

  it("restricts production administration to the dedicated admin hostname", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isAdminRequestHost(new Request("https://admin.ir35careers.com/api/admin"))).toBe(true);
    expect(isAdminRequestHost(new Request("https://www.ir35careers.com/api/admin"))).toBe(false);
    expect(isAdminRequestHost(new Request("https://ir-35-example.vercel.app/api/admin"))).toBe(false);
  });

  it("uses the routed Host header when the server request URL is internal", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isAdminRequestHost(new Request("http://127.0.0.1:3011/api/admin", {
      headers: { host: "admin.ir35careers.com:3011" },
    }))).toBe(true);
    expect(isAdminRequestHost(new Request("http://127.0.0.1:3011/api/admin", {
      headers: { host: "www.ir35careers.com" },
    }))).toBe(false);
  });

  it("allows loopback administration during local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isAdminRequestHost(new Request("http://127.0.0.1:3000/api/admin"))).toBe(true);
    expect(isAdminRequestHost(new Request("http://localhost:3000/api/admin"))).toBe(true);
  });
});
