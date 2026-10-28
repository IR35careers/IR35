import { afterEach, describe, expect, it, vi } from "vitest";
import { stagingHealthTargets } from "@/lib/staging-health-targets";
import { stackHealth } from "@/lib/stack-health";
import { mockWebTestEnv } from "../helpers/mock-web-fixture";

const settings = () => ({ ...mockWebTestEnv(), IR35_STAGING_HEALTH_FIXTURE: "webqa01",
  IR35_STAGING_KONG_HOST: "ir35-p8-webqa01-kong", SUPABASE_INTERNAL_URL: "http://ir35-p8-webqa01-kong:8000",
  NEXT_PUBLIC_SUPABASE_URL: "https://staging.ir35careers.com/supabase", VERCEL: undefined });
afterEach(() => { vi.unstubAllEnvs(); });
function configure(extra: Record<string, string | undefined> = {}) {
  for (const [name, value] of Object.entries({ ...settings(), NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-public-not-real",
    SUPABASE_SECRET_KEY: "fixture-staging-service-not-real", IR35_REALTIME_HEALTH_ENABLED: "true",
    IR35_WORKER_HEALTH_ENABLED: "true", IR35_BUILD_SHA: "a".repeat(40), ...extra })) vi.stubEnv(name, value);
}

describe("owned staging fixture health targets", () => {
  it("keeps the original fixed targets exactly when the new fixture mode is absent", () => {
    expect(stagingHealthTargets({})).toEqual({
      realtime: "http://realtime-dev.supabase-realtime:4000/api/tenants/realtime-dev/health", worker: "http://worker:8787/health",
    });
  });
  it("selects only the single owned backend under the complete mock/staging policy", () => {
    expect(stagingHealthTargets(settings())).toEqual({
      realtime: "http://ir35-p8-webqa01-realtime:4000/api/tenants/ir35-p8-webqa01/health",
      worker: "http://ir35-p8-webqa01-worker:8787/health",
    });
  });
  const rejected: Record<string, string | undefined>[] = [
    { IR35_STAGING_HEALTH_FIXTURE: undefined }, { IR35_STAGING_HEALTH_FIXTURE: "" },
    { IR35_STAGING_HEALTH_FIXTURE: "http://169.254.169.254" }, { IR35_STAGING_HEALTH_FIXTURE: "*" },
    { IR35_STAGING_HEALTH_FIXTURE: "other" }, { IR35_STAGING_KONG_HOST: "ir35-p5-kong" },
    { SUPABASE_INTERNAL_URL: "http://kong:8000" }, { SUPABASE_INTERNAL_URL: "http://ir35-p5-kong:8000" },
    { SUPABASE_INTERNAL_URL: "http://ir35-p8-webqa01-kong:8000/path" },
    { IR35_MOCK_WEB_ENABLED: "false" }, { IR35_STAGING: "false" }, { APPLY_RUNNER: "oracle" },
    { APPLICATION_WORKER_ACCEPT_JOBS: "true" }, { IR35_READ_ONLY: "true" }, { VERCEL: "1" },
    { IR35_SCHEDULER_ENABLED: "true" }, { APPLICATION_WORKER_CONCURRENCY: "2" },
    { IR35_MOCK_WEB_JOB_IDS: undefined }, { APPLICATION_WORKER_SECRET: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: "https://production-sentinel.invalid" },
    { RESEND_API_KEY: "fixture-live-provider-must-not-be-used" },
  ];
  it.each(rejected)("invalid or misbound fixture fails closed without any health request %#", async extra => {
    configure(extra); const fetcher = vi.fn<typeof fetch>();
    expect(stagingHealthTargets({ ...settings(), ...extra })).toBeNull();
    const result = await stackHealth(fetcher);
    expect(result.ok).toBe(false); expect(result.checks.worker).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/fixture-|production-sentinel|169\.254|ir35-p5/);
  });
  it("probes the actual five unique service endpoints with redirects forbidden", async () => {
    configure();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      const value = String(input);
      return new Response(JSON.stringify(value.endsWith(":8787/health") ? { ok: true, browserReady: true, databaseReady: true } : {}));
    });
    const result = await stackHealth(fetcher);
    expect(result.ok).toBe(true); expect(Object.values(result.checks)).toEqual(Array(5).fill("ready"));
    const urls = fetcher.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("http://ir35-p8-webqa01-realtime:4000/api/tenants/ir35-p8-webqa01/health");
    expect(urls).toContain("http://ir35-p8-webqa01-worker:8787/health");
    expect(urls.filter(url => url.startsWith("http://ir35-p8-webqa01-kong:8000/"))).toHaveLength(3);
    expect(urls.some(url => url.includes("ir35-p5-") || url.startsWith("http://worker:"))).toBe(false);
    for (const [, init] of fetcher.mock.calls) expect(init?.redirect).toBe("error");
  });
  it("does not fabricate readiness or switch targets when the owned service fails", async () => {
    configure(); const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("fixture-private-error-never-print"));
    const result = await stackHealth(fetcher);
    expect(result.ok).toBe(false); expect(Object.values(result.checks)).toEqual(Array(5).fill("unavailable"));
    expect(JSON.stringify(result)).not.toContain("fixture-private-error");
  });
});
