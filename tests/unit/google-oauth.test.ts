import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGoogleOAuthAuthorizeUrl } from "@/lib/google-oauth";

const SUPABASE_URL = "https://project-ref.supabase.co";

describe("Google OAuth server redirect", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("returns customers to the canonical dashboard", () => {
    const url = new URL(buildGoogleOAuthAuthorizeUrl({
      requestOrigin: "https://ir35careers.com",
      requestedPath: "/dashboard",
      supabaseUrl: SUPABASE_URL,
    }));
    expect(url.origin).toBe(SUPABASE_URL);
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe("https://www.ir35careers.com/auth/callback?next=%2Fdashboard");
  });

  it("returns administrators to the admin portal", () => {
    const url = new URL(buildGoogleOAuthAuthorizeUrl({
      requestOrigin: "https://admin.ir35careers.com",
      requestedPath: "/dashboard",
      supabaseUrl: SUPABASE_URL,
    }));
    expect(url.searchParams.get("redirect_to")).toBe("https://admin.ir35careers.com/");
  });

  it("forces the Google account chooser while preserving the contractor destination", () => {
    const url = new URL(buildGoogleOAuthAuthorizeUrl({
      requestOrigin: "https://www.ir35careers.com",
      requestedPath: "/applications",
      supabaseUrl: SUPABASE_URL,
      selectAccount: true,
    }));
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("redirect_to")).toBe("https://www.ir35careers.com/auth/callback?next=%2Fapplications");
  });

  it("rejects an untrusted customer destination", () => {
    const url = new URL(buildGoogleOAuthAuthorizeUrl({
      requestOrigin: "https://www.ir35careers.com",
      requestedPath: "https://attacker.example/steal",
      supabaseUrl: SUPABASE_URL,
    }));
    expect(url.searchParams.get("redirect_to")).toBe("https://www.ir35careers.com/auth/callback?next=%2Fdashboard");
  });

  it("keeps an explicitly enabled production-mode staging fallback on staging", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IR35_STAGING", "true");
    const url = new URL(buildGoogleOAuthAuthorizeUrl({
      requestOrigin: "https://staging.ir35careers.com",
      requestedPath: "/dashboard",
      supabaseUrl: "https://api-staging.ir35careers.com",
    }));
    expect(url.origin).toBe("https://api-staging.ir35careers.com");
    expect(url.searchParams.get("redirect_to")).toBe("https://staging.ir35careers.com/auth/callback?next=%2Fdashboard");
  });

  it("refuses other hosts, insecure origins, userinfo and path/query injection on staging", () => {
    vi.stubEnv("IR35_STAGING", "true");
    for (const requestOrigin of [
      "https://www.ir35careers.com", "https://admin.ir35careers.com", "https://attacker.example",
      "http://staging.ir35careers.com", "https://staging.ir35careers.com:8443",
      "https://owner:password-sentinel@staging.ir35careers.com", "https://staging.ir35careers.com/other",
      "https://staging.ir35careers.com/?next=https://attacker.example", "https://staging.ir35careers.com/#unsafe",
    ]) {
      expect(() => buildGoogleOAuthAuthorizeUrl({ requestOrigin, requestedPath: "/dashboard", supabaseUrl: SUPABASE_URL }))
        .toThrow("Staging OAuth requires the exact staging origin");
    }
  });

  it("does not enable staging automatically and retains safe destinations", () => {
    vi.stubEnv("IR35_STAGING", "false");
    const url = new URL(buildGoogleOAuthAuthorizeUrl({
      requestOrigin: "https://staging.ir35careers.com", requestedPath: "/dashboard", supabaseUrl: SUPABASE_URL,
    }));
    expect(url.searchParams.get("redirect_to")).toBe("https://www.ir35careers.com/auth/callback?next=%2Fdashboard");
    vi.stubEnv("IR35_STAGING", "true");
    const safe = new URL(buildGoogleOAuthAuthorizeUrl({
      requestOrigin: "https://staging.ir35careers.com", requestedPath: "https://attacker.example", supabaseUrl: SUPABASE_URL,
    }));
    expect(safe.searchParams.get("redirect_to")).toBe("https://staging.ir35careers.com/auth/callback?next=%2Fdashboard");
  });

  it("fails closed on malformed staging configuration without printing its value", () => {
    vi.stubEnv("IR35_STAGING", "invalid-public-fixture");
    expect(() => buildGoogleOAuthAuthorizeUrl({ requestOrigin: "https://staging.ir35careers.com", requestedPath: "/dashboard", supabaseUrl: SUPABASE_URL }))
      .toThrow("Invalid staging OAuth configuration");
  });
});
