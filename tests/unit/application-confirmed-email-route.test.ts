import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as submit } from "@/app/api/applications/submit/route";
import { POST as applyNext } from "@/app/api/automation/apply-next/route";

const fixture = vi.hoisted(() => ({ user: {} as Record<string, unknown> | null, internal: false,
  from: vi.fn(), rpc: vi.fn(), getUser: vi.fn(), getUserById: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: () => ({ auth: { getUser: fixture.getUser, admin: { getUserById: fixture.getUserById } }, from: fixture.from, rpc: fixture.rpc }) }));
vi.mock("@/lib/application-internal-resume", () => ({ verifyApplicationResumeAuthorization: () => fixture.internal, createApplicationResumeAuthorization: vi.fn() }));
vi.mock("@/lib/automation/internal-auth", () => ({ verifyScheduledAutoApplyAuthorization: () => fixture.internal }));

const userId = "00000000-0000-4000-8000-000000000001";
const makeRequest = (path: string, internal = false, includePacket = true) => new Request(`https://www.ir35careers.com/api/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(internal ? {} : { authorization: "Bearer controlled-test-token" }) }, body: JSON.stringify({ applicationId: "00000000-0000-4000-8000-000000000002", approval: "SUBMIT_APPROVED_APPLICATION", internalUserId: userId, ...(includePacket ? { packet: { untrusted: true } } : {}) }) });

beforeEach(() => {
  vi.clearAllMocks(); fixture.internal = false;
  fixture.user = { id: userId, email: "controlled@example.test", email_confirmed_at: null };
  fixture.getUser.mockImplementation(async () => ({ data: { user: fixture.user }, error: null }));
  fixture.getUserById.mockImplementation(async () => ({ data: { user: fixture.user }, error: null }));
  fixture.from.mockImplementation(() => { throw new Error("controlled stop before database access"); });
});

describe.each([{ name: "manual submit", handler: submit, path: "applications/submit" }, { name: "Auto Apply", handler: applyNext, path: "automation/apply-next" }])("$name verified email enforcement", ({ handler, path }) => {
  it.each([false, true])("rejects unconfirmed email before packet, queue or data access (internal %s)", async internal => {
    fixture.internal = internal;
    const response = await handler(makeRequest(path, internal));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "EMAIL_CONFIRMATION_REQUIRED", action: "/account?confirmation=1" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fixture.from).not.toHaveBeenCalled(); expect(fixture.rpc).not.toHaveBeenCalled();
    expect(internal ? fixture.getUserById : fixture.getUser).toHaveBeenCalledOnce();
    expect(internal ? fixture.getUser : fixture.getUserById).not.toHaveBeenCalled();
  });
  it("rejects phone-only confirmation and spoofed user metadata", async () => {
    fixture.user = { id: userId, email: "controlled@example.test", confirmed_at: new Date().toISOString(), phone_confirmed_at: new Date().toISOString(), user_metadata: { email_verified: true } };
    const response = await handler(makeRequest(path));
    expect(response.status).toBe(403); expect(fixture.from).not.toHaveBeenCalled();
  });
  it("rejects a missing identity before database access", async () => {
    fixture.user = null;
    expect((await handler(makeRequest(path))).status).toBe(401);
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it.each(["email", "google"])("allows provider-verified %s email to reach existing checks, not a submission", async provider => {
    fixture.user = { ...fixture.user, email_confirmed_at: "2026-10-18T03:00:00Z", app_metadata: { provider } };
    expect((await handler(makeRequest(path, false, false))).status).toBe(502);
    expect(fixture.from).toHaveBeenCalled(); expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
