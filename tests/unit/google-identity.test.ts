import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { GET } from "@/app/api/auth/google/route";
import { configuredGoogleClientId, createGoogleIdentityAttempt, generateGoogleNonce, googleCredentialMatches, googleIdentityApi, googleRedirectFallbackEnabled } from "@/lib/google-identity";

const clientId = "1234567890-controlled.apps.googleusercontent.com";
const jwt = (claims: Record<string, unknown>) => [Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url"), "controlled-test-signature"].join(".");
const claims = (nonce: string) => ({ nonce, aud: clientId, iss: "https://accounts.google.com", exp: Math.floor(Date.now() / 1000) + 3600 });
afterEach(() => vi.unstubAllEnvs());

describe("Google nonce / credential boundary", () => {
  it("generates 256-bit, distinct in-memory nonces and the SHA256 hex Google expects", async () => {
    const pair = await generateGoogleNonce(); const other = await generateGoogleNonce();
    expect(pair.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(other.raw).not.toBe(pair.raw); expect(other.hashed).not.toBe(pair.hashed);
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pair.raw))).toString("hex");
    expect(pair.hashed).toBe(digest); expect(pair.hashed).not.toBe(pair.raw);
  });
  it("passes only the matching token and original nonce to Supabase once", async () => {
    const attempt = await createGoogleIdentityAttempt(clientId);
    const credential = jwt(claims(attempt.hashedNonce));
    const exchange = vi.fn(async (token: string, nonce: string) => ({ token, nonce }));
    const result = await attempt.exchange({ credential }, exchange);
    expect(result.token).toBe(credential);
    expect(Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result.nonce))).toString("hex")).toBe(attempt.hashedNonce);
    expect(result.nonce).not.toBe(attempt.hashedNonce);
    await expect(attempt.exchange({ credential }, exchange)).rejects.toThrow("expired");
    expect(exchange).toHaveBeenCalledOnce();
  });
  it.each(["nonce", "aud", "iss", "exp"])("rejects mismatched %s before exchange", async field => {
    const attempt = await createGoogleIdentityAttempt(clientId);
    const wrong = { ...claims(attempt.hashedNonce), [field]: field === "exp" ? 1 : "not-this-attempt" };
    const exchange = vi.fn();
    await expect(attempt.exchange({ credential: jwt(wrong) }, exchange)).rejects.toThrow("mismatched");
    expect(exchange).not.toHaveBeenCalled();
  });
  it("prevents replay across attempts and consumes invalid callbacks too", async () => {
    const old = await createGoogleIdentityAttempt(clientId); const current = await createGoogleIdentityAttempt(clientId);
    const exchange = vi.fn();
    await expect(current.exchange({ credential: jwt(claims(old.hashedNonce)) }, exchange)).rejects.toThrow("mismatched");
    await expect(current.exchange({ credential: jwt(claims(current.hashedNonce)) }, exchange)).rejects.toThrow("expired");
    expect(exchange).not.toHaveBeenCalled();
  });
  it("expires and discards attempts without a network call", async () => {
    let now = Date.now(); const attempt = await createGoogleIdentityAttempt(clientId, () => now); const exchange = vi.fn();
    now += 300_000;
    await expect(attempt.exchange({ credential: jwt(claims(attempt.hashedNonce)) }, exchange)).rejects.toThrow("expired");
    const discarded = await createGoogleIdentityAttempt(clientId); discarded.discard();
    await expect(discarded.exchange({ credential: jwt(claims(discarded.hashedNonce)) }, exchange)).rejects.toThrow("expired");
    expect(exchange).not.toHaveBeenCalled();
  });
  it.each([null, {}, { credential: "x".repeat(17_000) }, { credential: "not.a.jwt" }, { credential: jwt({ nonce: "0".repeat(64), aud: clientId, iss: "accounts.google.com" }) }])("rejects malformed response (%j)", response => {
    expect(googleCredentialMatches(response, "0".repeat(64), clientId)).toBeNull();
  });
  it("validates the runtime Google API methods before calling them", () => {
    expect(googleIdentityApi({ initialize: 1, renderButton() {}, cancel() {} })).toBeNull();
    expect(googleIdentityApi(null)).toBeNull();
    expect(googleIdentityApi({ initialize() {}, renderButton() {}, cancel() {} })).not.toBeNull();
  });
});

describe("explicit fallback and configuration", () => {
  it.each([undefined, "false", "1", "TRUE"])("keeps redirect off for %s", value => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_REDIRECT_FALLBACK_ENABLED", value);
    expect(googleRedirectFallbackEnabled()).toBe(false);
  });
  it("rejects direct fallback requests unless the flag is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_REDIRECT_FALLBACK_ENABLED", "false");
    const response = await GET(new Request("https://www.ir35careers.com/api/auth/google?next=/dashboard"));
    expect(response.status).toBe(404); expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("retains canonical customer and admin redirects when explicitly enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_REDIRECT_FALLBACK_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://controlled.supabase.co");
    expect(googleRedirectFallbackEnabled()).toBe(true);
    for (const [origin, target] of [["https://www.ir35careers.com", "https://www.ir35careers.com/auth/callback?next=%2Finbox"], ["https://admin.ir35careers.com", "https://admin.ir35careers.com/"]]) {
      const response = await GET(new Request(`${origin}/api/auth/google?next=/inbox`));
      expect(response.status).toBe(302);
      expect(new URL(response.headers.get("location")!).searchParams.get("redirect_to")).toBe(target);
    }
  });
  it("accepts only an actual web-client-ID shape, not arbitrary configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "untrusted-value"); expect(configuredGoogleClientId()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", clientId); expect(configuredGoogleClientId()).toBe(clientId);
  });
});

describe("route-scoped GIS CSP", () => {
  it.each(["https://www.ir35careers.com/account", "https://admin.ir35careers.com/login", "https://www.ir35careers.com/admin/login"])("allows only documented GIS endpoints at %s", url => {
    const policy = proxy(new NextRequest(url, { headers: { host: new URL(url).host } })).headers.get("content-security-policy")!;
    expect(policy).toContain("https://accounts.google.com/gsi/client");
    expect(policy).toContain("https://accounts.google.com/gsi/style");
    expect(policy).toContain("frame-src 'self' https://accounts.google.com/gsi/");
    expect(policy).toContain("'strict-dynamic'"); expect(policy).toContain("'nonce-");
    expect(policy).not.toContain("*.google.com");
    expect(policy.split(";").find(value => value.trim().startsWith("script-src "))).not.toContain("'unsafe-inline'");
  });
  it.each(["/", "/dashboard", "/auth/callback", "/account/reset", "/jobs", "/api/auth/google"])("does not add GIS permissions to %s", path => {
    expect(proxy(new NextRequest(`https://www.ir35careers.com${path}`)).headers.get("content-security-policy")).not.toContain("accounts.google.com");
  });
});
