import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/applications/browser-handoff/route";

const fixture = vi.hoisted(() => ({ approved: true, createHandoff: vi.fn(), write: vi.fn(), ownerFilters: [] as string[] }));
vi.mock("@/lib/application-browser-handoff", () => ({ createApplicationBrowserHandoff: fixture.createHandoff, clearApplicationBrowserHandoff: vi.fn(), loadApplicationBrowserHandoff: vi.fn() }));
vi.mock("@/lib/application-portal-session", () => ({ loadPortalSession: async () => null }));
vi.mock("@/lib/security/public-url", () => ({ validatePublicHttpsUrl: async (value: string) => new URL(value) }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: () => ({
  auth: {
    getUser: async () => ({ data: { user: { id: "controlled-owner" } } }),
    admin: { getUserById: async () => ({ data: { user: { id: "controlled-owner", email: "controlled@example.test" } } }) },
  },
  from: (table: string) => {
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key: string, value: string) => { if (key === "user_id") fixture.ownerFilters.push(value); return chain; },
      upsert: fixture.write, update: fixture.write,
      maybeSingle: async () => ({ error: null, data: table === "application_packets" ? {
        truth_approved: fixture.approved, materials_approved: fixture.approved, submission_approved: fixture.approved,
        screening_answers: [], job_snapshot: { apply_url: "https://employer.example.test/apply" },
      } : table === "application_submissions" ? { receipt: { action: "captcha", state: "needs_user" } } : {} }),
    };
    return chain;
  },
}) }));
function request(token = "controlled-token") {
  return new Request("https://www.ir35careers.com/api/applications/browser-handoff", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action: "open_employer", applicationId: "a497269d-d5df-423a-9ff5-f68250b94ea8" }),
  });
}
beforeEach(() => { vi.clearAllMocks(); fixture.approved = true; fixture.ownerFilters = []; });
describe("extension-free manual employer step", () => {
  it("opens an owner-scoped URL without an extension token or a false processing status", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ employerUrl: "https://employer.example.test/apply", automatic: false });
    expect(fixture.ownerFilters).toContain("controlled-owner");
    expect(fixture.createHandoff).not.toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalled();
  });
  it("still requires a signed-in contractor and explicit approval", async () => {
    expect((await POST(request(""))).status).toBe(401);
    fixture.approved = false;
    expect((await POST(request())).status).toBe(409);
    expect(fixture.createHandoff).not.toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalled();
  });
});
