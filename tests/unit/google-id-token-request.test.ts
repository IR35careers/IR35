import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInWithGoogleIdToken } from "@/lib/auth-context";

const fixture = vi.hoisted(() => ({ configured: true, exchange: vi.fn() }));
vi.mock("@/lib/supabase-config", () => ({ isSupabaseConfigured: () => fixture.configured }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ auth: {
  signInWithIdToken: fixture.exchange,
  getSession: async () => ({ data: { session: null }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
} }) }));
vi.mock("@/lib/workspace/store", () => ({ clearWorkspaceForSignOut: vi.fn() }));
vi.mock("@/lib/resume/store", () => ({ clearLocalResumeVersions: vi.fn() }));
const nonce = "n".repeat(43);
const token = [Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: "controlled", nonce: "test-hash" })).toString("base64url"), "controlled-signature"].join(".");

beforeEach(() => {
  vi.clearAllMocks(); fixture.configured = true;
  vi.stubGlobal("window", { addEventListener: vi.fn(), localStorage: { removeItem: vi.fn() }, sessionStorage: { removeItem: vi.fn() } });
  fixture.exchange.mockResolvedValue({ data: { user: { id: "controlled-user", email: "controlled@example.test" }, session: null }, error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("Supabase ID-token request uses the original nonce", () => {
  it("sends provider, token and raw nonce, returning only the provider-confirmed account email", async () => {
    expect(await signInWithGoogleIdToken(token, nonce)).toEqual({ error: null, email: "controlled@example.test" });
    expect(fixture.exchange).toHaveBeenCalledExactlyOnceWith({ provider: "google", token, nonce });
  });
  it.each(["", "h".repeat(64), "https://evil.example/nonce"])("rejects missing/hashed/malformed nonce %s", async invalid => {
    expect((await signInWithGoogleIdToken(token, invalid)).error).toContain("nonce-bound");
    expect(fixture.exchange).not.toHaveBeenCalled();
  });
  it("rejects malformed token before any auth request", async () => {
    expect((await signInWithGoogleIdToken("not-an-id-token", nonce)).error).toContain("nonce-bound");
    expect(fixture.exchange).not.toHaveBeenCalled();
  });
  it("never claims offline preview success", async () => {
    fixture.configured = false;
    expect((await signInWithGoogleIdToken(token, nonce)).error).toContain("unavailable");
    expect(fixture.exchange).not.toHaveBeenCalled();
  });
  it("does not expose provider errors or missing identities as successful sign-in", async () => {
    fixture.exchange.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "untrusted-token-material", code: "bad_id_token" } });
    expect(await signInWithGoogleIdToken(token, nonce)).toEqual({ error: "Google sign-in could not be verified. Try again or use email.", code: "bad_id_token" });
    fixture.exchange.mockResolvedValueOnce({ data: { user: null, session: null }, error: null });
    expect((await signInWithGoogleIdToken(token, nonce)).error).toContain("could not be verified");
  });
  it("returns fixed connection failure copy", async () => {
    fixture.exchange.mockRejectedValueOnce(new Error("untrusted-token-material"));
    expect(await signInWithGoogleIdToken(token, nonce)).toEqual({ error: "Google sign-in could not connect. Try again or use email." });
  });
});
