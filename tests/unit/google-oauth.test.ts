import { describe, expect, it } from "vitest";
import { buildGoogleOAuthAuthorizeUrl } from "@/lib/google-oauth";

const SUPABASE_URL = "https://project-ref.supabase.co";

describe("Google OAuth server redirect", () => {
  it("returns customers to the canonical dashboard", () => {
    const url = new URL(buildGoogleOAuthAuthorizeUrl({
      requestOrigin: "https://ir35careers.com",
      requestedPath: "/dashboard",
      supabaseUrl: SUPABASE_URL,
    }));
    expect(url.origin).toBe(SUPABASE_URL);
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe("https://www.ir35careers.com/dashboard");
  });

  it("returns administrators to the admin portal", () => {
    const url = new URL(buildGoogleOAuthAuthorizeUrl({
      requestOrigin: "https://admin.ir35careers.com",
      requestedPath: "/dashboard",
      supabaseUrl: SUPABASE_URL,
    }));
    expect(url.searchParams.get("redirect_to")).toBe("https://admin.ir35careers.com/");
  });

  it("rejects an untrusted customer destination", () => {
    const url = new URL(buildGoogleOAuthAuthorizeUrl({
      requestOrigin: "https://www.ir35careers.com",
      requestedPath: "https://attacker.example/steal",
      supabaseUrl: SUPABASE_URL,
    }));
    expect(url.searchParams.get("redirect_to")).toBe("https://www.ir35careers.com/dashboard");
  });
});
