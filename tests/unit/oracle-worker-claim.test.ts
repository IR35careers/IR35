import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/applications/worker/claim/route";

const fixture = vi.hoisted(() => ({
  claim: { workerId: "oracle-controlled", startedAt: "2026-10-18T03:00:00Z", acceptTask: true, preferredApplicationId: "11111111-1111-4111-8111-111111111111" as string | undefined, active: 0, concurrency: 1, completed: 0, failed: 0, version: "controlled" },
  admin: vi.fn(),
}));
vi.mock("@/lib/application-worker-auth", () => ({ applicationWorkerConfig: () => ({ enabled: true }) }));
vi.mock("@/lib/application-worker-request", () => ({ readSignedApplicationWorkerJson: async () => fixture.claim, ApplicationWorkerRequestError: class extends Error {} }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: fixture.admin }));

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APPLY_RUNNER", "oracle");
  fixture.claim.workerId = "oracle-controlled"; fixture.claim.acceptTask = true;
  fixture.claim.preferredApplicationId = "11111111-1111-4111-8111-111111111111";
  fixture.admin.mockImplementation(() => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { status: "running" }, error: null }) };
    return { from: () => chain };
  });
});
afterEach(() => vi.unstubAllEnvs());
const request = () => new Request("https://www.ir35careers.com/api/applications/worker/claim", { method: "POST" });

describe("one selected queue consumer, no stale lease replay", () => {
  it.each(["vercel-controlled", "railway-controlled", "legacy-controlled"])("rejects unselected %s before database access", async workerId => {
    fixture.claim.workerId = workerId;
    expect((await POST(request())).status).toBe(409); expect(fixture.admin).not.toHaveBeenCalled();
  });
  it("rejects an unscoped Oracle claim before database access", async () => {
    fixture.claim.preferredApplicationId = undefined;
    expect((await POST(request())).status).toBe(409); expect(fixture.admin).not.toHaveBeenCalled();
  });
  it.each(["oracle-controlled", "railway-controlled", "queue-controlled"])("rejects %s consumption while Vercel remains selected", async workerId => {
    vi.stubEnv("APPLY_RUNNER", "vercel"); fixture.claim.workerId = workerId;
    expect((await POST(request())).status).toBe(409); expect(fixture.admin).not.toHaveBeenCalled();
  });
  it.each(["oracle", "railway"])("preserves the running-outcome guard for %s", async runner => {
    vi.stubEnv("APPLY_RUNNER", runner); fixture.claim.workerId = `${runner}-controlled`;
    const response = await POST(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ assignment: null });
    expect(fixture.admin).toHaveBeenCalledOnce();
  });
});
