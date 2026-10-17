import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/applications/browser-handoff/route";

const fixture = vi.hoisted(() => ({ approved: true, deliveryStatus: "needs_info" as string | undefined,
  owner: "11111111-1111-4111-8111-111111111111", signedIn: true,
  createHandoff: vi.fn(), write: vi.fn<(table: string, data: unknown, options: unknown) => Promise<{ error: null }>>().mockResolvedValue({ error: null }), ownerFilters: [] as string[] }));
vi.mock("@/lib/application-browser-handoff", () => ({ createApplicationBrowserHandoff: fixture.createHandoff, clearApplicationBrowserHandoff: vi.fn(), loadApplicationBrowserHandoff: vi.fn() }));
vi.mock("@/lib/application-portal-session", () => ({ loadPortalSession: async () => null }));
vi.mock("@/lib/security/public-url", () => ({ validatePublicHttpsUrl: async (value: string) => new URL(value) }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: () => ({
  auth: {
    getUser: async () => ({ data: { user: fixture.signedIn ? { id: "11111111-1111-4111-8111-111111111111" } : null } }),
  },
  from: (table: string) => {
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key: string, value: string) => { if (key === "user_id") fixture.ownerFilters.push(value); return chain; },
      upsert: (data: unknown, options: unknown) => fixture.write(table, data, options), update: fixture.write,
      maybeSingle: async () => ({ error: null, data: table === "application_packets" ? {
        id: "a497269d-d5df-423a-9ff5-f68250b94ea8", user_id: fixture.owner, delivery_status: fixture.deliveryStatus,
        truth_approved: fixture.approved, materials_approved: fixture.approved, submission_approved: fixture.approved,
        screening_answers: [], job_snapshot: { apply_url: "https://employer.example.test/apply" },
      } : table === "application_submissions" ? { receipt: { action: "captcha", state: "needs_user" } } : {} }),
    };
    return chain;
  },
}) }));
function request(token = "controlled-token", action = "open_employer") {
  return new Request("https://www.ir35careers.com/api/applications/browser-handoff", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, applicationId: "a497269d-d5df-423a-9ff5-f68250b94ea8" }),
  });
}
beforeEach(() => { vi.clearAllMocks(); fixture.approved = true; fixture.ownerFilters = []; fixture.deliveryStatus = "needs_info";
  fixture.owner = "11111111-1111-4111-8111-111111111111"; fixture.signedIn = true; });
describe("extension-free manual employer step", () => {
  it("opens an owner-scoped URL without an extension token or a false processing status", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ employerUrl: "https://employer.example.test/apply", automatic: false });
    expect(fixture.ownerFilters).toContain(fixture.owner);
    expect(fixture.createHandoff).not.toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalled();
  });
  it("records contractor reports as unverified notes, never fabricated submitted receipts", async () => {
    fixture.deliveryStatus = "external_only";
    const response = await POST(request("controlled-token", "confirm_manual"));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ reported: true, deliveryStatus: "external_only" });
    expect(fixture.write).toHaveBeenCalledExactlyOnceWith("application_events", expect.objectContaining({
      event_type: "note", metadata: { confirmationSource: "contractor", verified: false },
      idempotency_key: "manual-report:a497269d-d5df-423a-9ff5-f68250b94ea8",
    }), { onConflict: "user_id,idempotency_key", ignoreDuplicates: true });
  });
  it("does not open or report a second application while the worker is in flight", async () => {
    for (const status of ["queued", "submitting"]) {
      fixture.deliveryStatus = status;
      expect((await POST(request())).status).toBe(409);
      expect((await POST(request("controlled-token", "confirm_manual"))).status).toBe(409);
    }
    expect(fixture.write).not.toHaveBeenCalled();
  });
  it("preserves an existing submitted outcome without another write", async () => {
    fixture.deliveryStatus = "submitted";
    const response = await POST(request("controlled-token", "confirm_manual"));
    expect(await response.json()).toMatchObject({ reported: false, deliveryStatus: "submitted" });
    expect(fixture.write).not.toHaveBeenCalled();
  });
  it("rejects another owner's row and expired sessions", async () => {
    fixture.owner = "22222222-2222-4222-8222-222222222222";
    expect((await POST(request("controlled-token", "confirm_manual"))).status).toBe(404);
    fixture.signedIn = false;
    expect((await POST(request())).status).toBe(401);
    expect(fixture.write).not.toHaveBeenCalled();
  });
  it("fails closed when the lifecycle migration is missing", async () => {
    fixture.deliveryStatus = undefined;
    expect((await POST(request())).status).toBe(502);
    expect(fixture.write).not.toHaveBeenCalled();
  });
  it("retires legacy extension exports and callbacks without private data or state writes", async () => {
    expect(GET(new Request("https://www.ir35careers.com/api/applications/browser-handoff?kind=verification&token=old-token")).status).toBe(410);
    expect((await POST(request("", "create"))).status).toBe(410);
    expect((await POST(request("", "result"))).status).toBe(410);
    expect(fixture.createHandoff).not.toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalled();
    expect(fixture.ownerFilters).toEqual([]);
  });
  it("still requires a signed-in contractor and explicit approval", async () => {
    expect((await POST(request(""))).status).toBe(401);
    fixture.approved = false;
    expect((await POST(request())).status).toBe(409);
    expect(fixture.createHandoff).not.toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalled();
  });
});
