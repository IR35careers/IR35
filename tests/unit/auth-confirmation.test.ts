import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authCallbackDetails, completeAuthCallback, confirmationFailure, hasConfirmedApplicationEmail } from "@/lib/auth-confirmation";
import { accountSignInPath, applicationAuthJobId, canonicalAuthCallbackUrl, resolvePostAuthPath } from "@/lib/auth-routing";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const id = "7d8d7d76-72f9-4245-8112-b43a1ae5b797";
const next = `/applications/new/${id}?applicationId=00000000-0000-4000-8000-000000000009#final-application-approval`;
const verified = { email: "controlled@example.test", email_confirmed_at: "2026-10-18T03:00:00Z" };

describe("confirmed account email boundary", () => {
  it.each([null, {}, { ...verified, email_confirmed_at: null }, { ...verified, email_confirmed_at: "" },
    { ...verified, email: "not-an-email" }, { ...verified, email_confirmed_at: "not-a-date" },
    { email: verified.email, confirmed_at: verified.email_confirmed_at, phone_confirmed_at: verified.email_confirmed_at },
    { email: verified.email, user_metadata: { email_verified: true, email_confirmed_at: verified.email_confirmed_at } },
  ])("rejects unconfirmed, phone-only or user-editable claims (%j)", user => expect(hasConfirmedApplicationEmail(user)).toBe(false));
  it("accepts email confirmation for password and OAuth users equally", () => {
    expect(hasConfirmedApplicationEmail(verified)).toBe(true);
    expect(hasConfirmedApplicationEmail({ ...verified, app_metadata: { provider: "google" } })).toBe(true);
  });
});

describe("canonical confirmation and saved apply intent", () => {
  it("preserves only internal approved destinations, queries and anchors", () => {
    const callback = new URL(canonicalAuthCallbackUrl(next));
    expect(callback.origin).toBe("https://www.ir35careers.com");
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("next")).toBe(next);
    expect(new URL(accountSignInPath(next), callback.origin).searchParams.get("next")).toBe(next);
    expect(applicationAuthJobId(next)).toBe(id);
    expect(applicationAuthJobId(`/jobs/${id}/resume`)).toBe(id);
    expect(applicationAuthJobId("/applications/new/not-a-job?title=Spoofed&company=Spoofed")).toBeNull();
    expect(resolvePostAuthPath("/account/reset")).toBe("/account/reset");
    expect(resolvePostAuthPath("/account/reset/evil")).toBe("/dashboard");
  });
  it.each(["https://evil.example/dashboard", "//evil.example/dashboard", "/\\evil.example/dashboard", "/auth/callback?next=/inbox", "/api/admin"])("rejects unsafe return %s", unsafe => {
    expect(new URL(canonicalAuthCallbackUrl(unsafe)).searchParams.get("next")).toBe("/dashboard");
  });
  it("reads safe fixed error states, never reflects provider text or credentials", () => {
    expect(authCallbackDetails(`${canonicalAuthCallbackUrl(next)}#error=access_denied&error_code=otp_expired&error_description=untrusted-secret`)).toEqual({ next, failure: "expired" });
    expect(authCallbackDetails("https://www.ir35careers.com/auth/callback?next=//evil.example&error_description=untrusted-secret")).toEqual({ next: "/dashboard", failure: "invalid" });
    expect(confirmationFailure({ details: { code: "flow_state_expired" } })).toBe("expired");
    expect(confirmationFailure({ message: "otp_expired" })).toBe("invalid");
  });
  it("never caches the callback or sends its URL as a referrer; nonce CSP remains", () => {
    const response = proxy(new NextRequest(canonicalAuthCallbackUrl(next)));
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-security-policy")).toContain("'strict-dynamic'");
  });
});

describe("callback SDK session handling", () => {
  function client(user: unknown = verified, initError: unknown = null, userError: unknown = null) {
    const auth = { initialize: vi.fn().mockResolvedValue({ error: initError }), getUser: vi.fn().mockResolvedValue({ data: { user }, error: userError }), exchangeCodeForSession: vi.fn(), setSession: vi.fn() };
    return { auth, callbackAuth: auth as unknown as SupabaseClient["auth"] };
  }
  it("awaits SDK initialization then independently verifies the user, without replaying a code", async () => {
    const fixture = client();
    expect(await completeAuthCallback(fixture.callbackAuth)).toEqual({ state: "confirmed", email: verified.email });
    expect(fixture.auth.initialize).toHaveBeenCalledOnce();
    expect(fixture.auth.getUser).toHaveBeenCalledOnce();
    expect(fixture.auth.initialize.mock.invocationCallOrder[0]).toBeLessThan(fixture.auth.getUser.mock.invocationCallOrder[0]);
    expect(fixture.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(fixture.auth.setSession).not.toHaveBeenCalled();
  });
  it("does not use a previously logged-in user when this link has expired", async () => {
    const fixture = client(verified, { details: { code: "otp_expired" } });
    expect(await completeAuthCallback(fixture.callbackAuth)).toEqual({ state: "expired" });
    expect(fixture.auth.getUser).not.toHaveBeenCalled();
  });
  it("distinguishes valid but unconfirmed email from an invalid session", async () => {
    expect(await completeAuthCallback(client({ email: verified.email, email_confirmed_at: null }).callbackAuth)).toEqual({ state: "unconfirmed" });
    expect(await completeAuthCallback(client(null).callbackAuth)).toEqual({ state: "invalid" });
    expect(await completeAuthCallback(client(verified, null, { code: "bad_jwt" }).callbackAuth)).toEqual({ state: "invalid" });
  });
  it("fails closed on network exceptions without exposing their message", async () => {
    const fixture = client(); fixture.auth.initialize.mockRejectedValue(new Error("untrusted-secret"));
    expect(await completeAuthCallback(fixture.callbackAuth)).toEqual({ state: "invalid" });
  });
});
