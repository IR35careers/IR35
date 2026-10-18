import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestPasswordReset, resendConfirmation, signUpWithPassword } from "@/lib/auth-context";

const fixture = vi.hoisted(() => ({ configured: true, signUp: vi.fn(), resend: vi.fn(), resetPasswordForEmail: vi.fn() }));
vi.mock("@/lib/supabase-config", () => ({ isSupabaseConfigured: () => fixture.configured }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ auth: { signUp: fixture.signUp, resend: fixture.resend, resetPasswordForEmail: fixture.resetPasswordForEmail } }) }));
vi.mock("@/lib/workspace/store", () => ({ clearWorkspaceForSignOut: vi.fn() }));
vi.mock("@/lib/resume/store", () => ({ clearLocalResumeVersions: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks(); fixture.configured = true;
  fixture.signUp.mockResolvedValue({ data: { user: { id: "controlled-id" }, session: null }, error: null });
  fixture.resend.mockResolvedValue({ error: null });
  fixture.resetPasswordForEmail.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("provider email action payloads (mock transport only)", () => {
  it("sign-up uses canonical www callback even without a browser origin", async () => {
    const next = "/applications/new/7d8d7d76-72f9-4245-8112-b43a1ae5b797?from=saved#review";
    expect(await signUpWithPassword(" Controlled@Example.test ", "not-a-real-password", next)).toEqual({ error: null, needsConfirmation: true });
    const input = fixture.signUp.mock.calls[0][0];
    expect(input.email).toBe("controlled@example.test");
    const callback = new URL(input.options.emailRedirectTo);
    expect(callback.origin).toBe("https://www.ir35careers.com");
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("next")).toBe(next);
  });
  it("resend uses signup confirmation and safe next, not a magic-link login", async () => {
    expect(await resendConfirmation("Controlled@Example.test", "//evil.example")).toEqual({ error: null, code: undefined });
    expect(fixture.resend).toHaveBeenCalledWith({ type: "signup", email: "controlled@example.test", options: { emailRedirectTo: "https://www.ir35careers.com/auth/callback?next=%2Fdashboard" } });
    expect(fixture.signUp).not.toHaveBeenCalled();
  });
  it("reset keeps its separate password-reset destination through the callback", async () => {
    await requestPasswordReset("Controlled@Example.test");
    expect(fixture.resetPasswordForEmail).toHaveBeenCalledWith("controlled@example.test", { redirectTo: "https://www.ir35careers.com/auth/callback?next=%2Faccount%2Freset" });
  });
  it("rejects malformed email without a request", async () => {
    expect((await resendConfirmation("not email")).error).toContain("valid account email");
    expect(fixture.resend).not.toHaveBeenCalled();
  });
  it("does not report fake success in offline previews", async () => {
    fixture.configured = false;
    expect((await resendConfirmation("controlled@example.test")).error).toContain("unavailable");
    expect(fixture.resend).not.toHaveBeenCalled();
  });
  it("returns safe fixed provider/network failure copy", async () => {
    fixture.resend.mockResolvedValueOnce({ error: { code: "over_email_send_rate_limit", message: "untrusted-provider-secret" } });
    expect(await resendConfirmation("controlled@example.test")).toEqual({ error: "We could not request a confirmation email. Please wait before trying again.", code: "over_email_send_rate_limit" });
    fixture.resend.mockRejectedValueOnce(new Error("untrusted-network-secret"));
    expect((await resendConfirmation("controlled@example.test")).error).toBe("Email confirmation could not connect. Please try again later.");
  });
});
