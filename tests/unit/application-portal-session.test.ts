import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openPortalSession,
  sealPortalSession,
} from "@/lib/application-portal-session";
import type { NativePortalSession } from "@/lib/application-submission";

afterEach(() => vi.unstubAllEnvs());

const SESSION: NativePortalSession = {
  currentUrl: "https://jobs.ashbyhq.com/example/application",
  accountState: "created",
  storageState: {
    cookies: [
      {
        name: "session",
        value: "private-cookie",
        domain: "jobs.ashbyhq.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [],
  },
};

describe("encrypted employer application sessions", () => {
  it("round trips a browser session without storing the cookie in plaintext", () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", "test-secret-with-enough-entropy");
    const sealed = sealPortalSession(SESSION);
    expect(sealed).not.toContain("private-cookie");
    expect(openPortalSession(sealed)).toEqual(SESSION);
  });

  it("rejects a modified encrypted session", () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", "test-secret-with-enough-entropy");
    const sealed = sealPortalSession(SESSION);
    const altered = `${sealed.slice(0, -1)}${sealed.endsWith("A") ? "B" : "A"}`;
    expect(() => openPortalSession(altered)).toThrow();
  });
});
