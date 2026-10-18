import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { completeAuthCallback } from "@/lib/auth-confirmation";

const user = { id: "00000000-0000-4000-8000-000000000001", email: "controlled@example.test", email_confirmed_at: "2026-10-18T03:00:00Z", aud: "authenticated", role: "authenticated", created_at: "2026-10-18T03:00:00Z", app_metadata: {}, user_metadata: {} };
let client: SupabaseClient | null = null;
afterEach(() => { client?.auth.dispose(); client = null; vi.unstubAllGlobals(); });

describe("actual installed Supabase SDK callback (isolated mock transport)", () => {
  function setup(url: string, flowType: "implicit" | "pkce" = "implicit", withVerifier = false) {
    const location = new URL(url);
    const history = { state: null, replaceState: vi.fn((_state: unknown, _title: string, value: string) => { location.href = new URL(value, location).href; }) };
    vi.stubGlobal("window", { location, history });
    vi.stubGlobal("document", { visibilityState: "hidden" });
    vi.stubGlobal("BroadcastChannel", undefined);
    const stored = new Map<string, string>();
    if (withVerifier) stored.set("controlled-callback-code-verifier", JSON.stringify("controlled-one-use-verifier"));
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      const target = new URL(String(input));
      if (target.hostname !== "controlled-auth.example.test") throw new Error("Unexpected network destination");
      if (target.pathname === "/auth/v1/user") return Response.json(user);
      if (target.pathname === "/auth/v1/token" && target.searchParams.get("grant_type") === "pkce") return Response.json({ user, access_token: "controlled-mock-access", refresh_token: "controlled-mock-refresh", token_type: "bearer", expires_in: 3600 });
      throw new Error("Unexpected auth operation");
    });
    client = createClient("https://controlled-auth.example.test", "controlled-public-test-key", { auth: { flowType, autoRefreshToken: false, storageKey: "controlled-callback", storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } } }, global: { fetch: transport } });
    return { auth: client.auth, location, stored, transport };
  }
  it("consumes implicit tokens and verifies the user without a second exchange", async () => {
    const fixture = setup("https://www.ir35careers.com/auth/callback?next=%2Finbox#access_token=controlled-mock-access&refresh_token=controlled-mock-refresh&expires_in=3600&token_type=bearer&type=signup");
    expect(await completeAuthCallback(fixture.auth)).toEqual({ state: "confirmed", email: user.email });
    expect(fixture.location.hash).toBe("");
    expect(fixture.transport.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(["/auth/v1/user", "/auth/v1/user"]);
    expect(fixture.stored.has("controlled-callback")).toBe(true);
  });
  it("exchanges a configured PKCE callback once, then uses the cached initialization result", async () => {
    const fixture = setup("https://www.ir35careers.com/auth/callback?next=%2Finbox&code=controlled-one-use-code", "pkce", true);
    expect(await completeAuthCallback(fixture.auth)).toEqual({ state: "confirmed", email: user.email });
    expect(fixture.transport.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/auth/v1/token")).toHaveLength(1);
    expect(fixture.transport.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/auth/v1/user")).toHaveLength(1);
    expect(fixture.location.searchParams.has("code")).toBe(false);
    expect(fixture.stored.has("controlled-callback-code-verifier")).toBe(false);
  });
  it("classifies SDK expired-link errors without any token/user request", async () => {
    const fixture = setup("https://www.ir35careers.com/auth/callback#error=access_denied&error_code=otp_expired&error_description=controlled-expired-link");
    expect(await completeAuthCallback(fixture.auth)).toEqual({ state: "expired" });
    expect(fixture.transport).not.toHaveBeenCalled();
  });
});
