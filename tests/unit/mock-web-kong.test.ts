import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseTransport } from "@/lib/supabase-transport";
import { mockWebTestEnv } from "../helpers/mock-web-fixture";

afterEach(() => { vi.unstubAllEnvs(); });
function configure(extra: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ ...mockWebTestEnv(), VERCEL: undefined,
    NEXT_PUBLIC_SUPABASE_URL: "https://staging.ir35careers.com/supabase",
    SUPABASE_INTERNAL_URL: "http://ir35-p8-webqa01-kong:8000", IR35_STAGING_KONG_HOST: "ir35-p8-webqa01-kong", ...extra }))
    vi.stubEnv(key, value);
}
describe("private writable QA Supabase route isolation", () => {
  it("rewrites only into the one explicitly named fixture, retaining no-redirect and SDK auth body", async () => {
    configure(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const adapter = supabaseTransport(fetcher);
    const init = { method: "POST", body: '{"opaque":"fixture"}', headers: { apikey: "public-fixture-token-not-real" } };
    await adapter("https://staging.ir35careers.com/supabase/auth/v1/token?grant_type=password", init);
    expect(String(fetcher.mock.calls[0][0])).toBe("http://ir35-p8-webqa01-kong:8000/auth/v1/token?grant_type=password");
    expect(fetcher.mock.calls[0][1]).toEqual({ ...init, redirect: "error" });
  });
  it.each([
    { SUPABASE_INTERNAL_URL: undefined }, { IR35_STAGING_KONG_HOST: undefined },
    { IR35_STAGING_KONG_HOST: "ir35-p5-kong" }, { SUPABASE_INTERNAL_URL: "http://ir35-p5-kong:8000" },
    { SUPABASE_INTERNAL_URL: "http://kong:8000" }, { SUPABASE_INTERNAL_URL: "http://169.254.169.254:8000" },
    { SUPABASE_INTERNAL_URL: "http://ir35-p8-webqa01-kong:8000/unapproved" },
    { IR35_STAGING: "false" }, { APPLY_RUNNER: "vercel" }, { VERCEL: "1" },
    { APPLICATION_WORKER_ACCEPT_JOBS: "true" }, { IR35_READ_ONLY: "true" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://public-cloud-sentinel.invalid" },
    { IR35CAREERS_APP_URL: "https://www.ir35careers.com" }, { IR35_STAGING_KONG_HOST: "*" },
  ])("refuses any missing/misrouted/production setting without a request %#", extra => {
    configure(extra); const fetcher = vi.fn<typeof fetch>();
    expect(() => supabaseTransport(fetcher)).toThrow(/Invalid/); expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not activate the new fixture on a normal runtime", () => {
    configure({ IR35_MOCK_WEB_ENABLED: "false" });
    expect(() => supabaseTransport()).toThrow("isolated fixture");
  });
  it("rejects a different public origin or prefix before forwarding a credential", async () => {
    configure(); const fetcher = vi.fn<typeof fetch>(), adapter = supabaseTransport(fetcher);
    for (const url of ["https://www.ir35careers.com/auth/v1/user", "https://staging.ir35careers.com/auth/v1/user",
      "https://staging.ir35careers.com/supabase/api/admin"])
      await expect(adapter(url, { headers: { apikey: "public-fixture-token-not-real" } })).rejects.toThrow("refused");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
