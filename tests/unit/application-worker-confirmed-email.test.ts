import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/applications/worker/claim/route";
import { executeApplicationWorkerAssignment } from "@/lib/application-worker-executor";
import { buildApplicationAttention } from "@/lib/application-attention";
import type { ApplicationWorkerAssignment } from "@/lib/application-worker-types";

const fixture = vi.hoisted(() => ({ user: null as Record<string, unknown> | null, browser: vi.fn(), alias: vi.fn() }));
vi.mock("@/lib/application-runner/run", () => ({ runNativeApplication: fixture.browser }));
vi.mock("@/lib/application-worker-auth", () => ({ applicationWorkerConfig: () => ({ enabled: true }) }));
vi.mock("@/lib/application-worker-request", () => ({
  readSignedApplicationWorkerJson: async () => ({ workerId: "vercel-controlled-test", startedAt: "2026-10-18T03:00:00Z", acceptTask: true, active: 0, concurrency: 1, completed: 0, failed: 0, version: "controlled" }),
  ApplicationWorkerRequestError: class extends Error {},
}));
vi.mock("@/lib/email/inbox-alias", () => ({ ensureInboxAlias: fixture.alias, applicationInboxAlias: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: () => ({
  auth: { admin: { getUserById: async () => ({ data: { user: fixture.user }, error: null }) } },
  rpc: async () => ({ data: [{ id: "00000000-0000-4000-8000-000000000003", user_id: "00000000-0000-4000-8000-000000000001", application_id: "00000000-0000-4000-8000-000000000002", status: "running", attempts: 1, idempotency_key: "controlled-test", destination: "https://mock-ats.example.test/apply" }], error: null }),
  from: (table: string) => {
    const chain = { upsert: async () => ({ error: null }), select: () => chain, eq: () => chain, maybeSingle: async () => ({ error: null, data: table === "application_packets" ? { truth_approved: false, materials_approved: false, submission_approved: false } : { application_profile: {} } }) };
    return chain;
  },
}) }));

beforeEach(() => { vi.clearAllMocks(); fixture.user = { email: "controlled@example.test", email_confirmed_at: null }; });

describe("execution-time account email confirmation", () => {
  it.each([null, { email: "controlled@example.test", email_confirmed_at: null }, { email: "controlled@example.test", confirmed_at: "2026-10-18T03:00:00Z", user_metadata: { email_verified: true } }])("stops old queued or changed-identity tasks before any browser payload (%j)", async user => {
    fixture.user = user;
    const response = await POST(new Request("https://www.ir35careers.com/api/applications/worker/claim", { method: "POST" }));
    expect(response.status).toBe(200);
    const { assignment } = await response.json() as { assignment: ApplicationWorkerAssignment };
    expect(assignment.preflightError).toContain("Confirm your account email");
    expect(assignment.preflightAction).toBe("account_email_confirmation");
    expect(assignment.payload).toBeUndefined(); expect(assignment.portalPassword).toBeUndefined();
    const callback = await executeApplicationWorkerAssignment({ assignment, appOrigin: "https://www.ir35careers.com" });
    expect(callback.receipt).toMatchObject({ state: "needs_user", review: { action: "account_email_confirmation" } });
    expect(fixture.browser).not.toHaveBeenCalled(); expect(fixture.alias).not.toHaveBeenCalled();
    expect(buildApplicationAttention({ action: "account_email_confirmation", message: assignment.preflightError })).toMatchObject({ title: "Confirm your IR35Careers account email", action: "/account?confirmation=1&next=%2Fapplications", actionLabel: "Request confirmation email" });
  });
  it("still requires approval even for a confirmed account", async () => {
    fixture.user = { email: "controlled@example.test", email_confirmed_at: "2026-10-18T03:00:00Z" };
    const response = await POST(new Request("https://www.ir35careers.com/api/applications/worker/claim", { method: "POST" }));
    const { assignment } = await response.json() as { assignment: ApplicationWorkerAssignment };
    expect(assignment.preflightError).toBe("The approved application packet is no longer complete.");
    expect(fixture.browser).not.toHaveBeenCalled(); expect(fixture.alias).not.toHaveBeenCalled();
  });
});
