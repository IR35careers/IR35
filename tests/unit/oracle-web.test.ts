import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readOnlyMaintenance, blockedByMaintenance } from "@/lib/maintenance-mode";
import { supabaseTransport } from "@/lib/supabase-transport";
import { publicSearchParams, initialJobSearchSchema } from "@/lib/job-search-response";
import { stackHealth } from "@/lib/stack-health";
import { cacheableHomepage, hashedPublicPolicy, HomepageCache } from "../../services/web/public-html";
import { selectedApplyRunner } from "@/lib/application-runner-selection";

afterEach(() => vi.unstubAllEnvs());

describe("read-only maintenance", () => {
  it("defaults off, fails closed on a typo, denies actions and cron writes but permits safe reads", () => {
    expect(readOnlyMaintenance({})).toBe(false);
    expect(readOnlyMaintenance({ IR35_READ_ONLY: "ture" })).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(blockedByMaintenance(method, "/api/profile", { IR35_READ_ONLY: "true" })).toBe(true);
      expect(blockedByMaintenance(method, "/profile", { IR35_READ_ONLY: "true" })).toBe(true);
    }
    expect(blockedByMaintenance("GET", "/api/pipeline/fetch", { IR35_READ_ONLY: "true" })).toBe(true);
    expect(blockedByMaintenance("GET", "/api/automation/run", { IR35_READ_ONLY: "true" })).toBe(true);
    expect(blockedByMaintenance("GET", "/api/jobs/search", { IR35_READ_ONLY: "true" })).toBe(false);
  });
  it("refuses mock outside isolated staging or on Vercel", () => {
    vi.stubEnv("APPLY_RUNNER", "mock"); vi.stubEnv("IR35_STAGING", "false");
    expect(() => selectedApplyRunner()).toThrow("isolated");
    vi.stubEnv("IR35_STAGING", "true"); vi.stubEnv("VERCEL", "1");
    expect(() => selectedApplyRunner()).toThrow("isolated");
    vi.stubEnv("VERCEL", ""); expect(selectedApplyRunner()).toBe("mock");
  });
});

describe("server-only Supabase transport", () => {
  const setup = () => {
    vi.stubEnv("SUPABASE_INTERNAL_URL", "http://ir35-p5-kong:8000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://staging.ir35careers.com/supabase");
  };
  it("retains public SDK URLs but sends only exact API paths privately, credentials and abort signal intact", async () => {
    setup(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const transport = supabaseTransport(fetcher); const signal = new AbortController().signal;
    await transport("https://staging.ir35careers.com/supabase/rest/v1/jobs?select=id", { headers: { apikey: "test-only" }, signal });
    expect(String(fetcher.mock.calls[0][0])).toBe("http://ir35-p5-kong:8000/rest/v1/jobs?select=id");
    expect(fetcher.mock.calls[0][1]).toEqual({ headers: { apikey: "test-only" }, signal, redirect: "error" });
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://staging.ir35careers.com/supabase");
  });
  it("rejects SSRF/redirect destinations before sending credentials", async () => {
    setup(); const fetcher = vi.fn<typeof fetch>(); const transport = supabaseTransport(fetcher);
    for (const url of ["https://evil.test/supabase/auth/v1/token", "https://staging.ir35careers.com/api/admin", "https://staging.ir35careers.com/supabase/../admin", "https://staging.ir35careers.com/supabaseX/rest/v1/jobs"]) {
      await expect(transport(url)).rejects.toThrow("refused");
    }
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv("SUPABASE_INTERNAL_URL", "http://169.254.169.254:8000");
    expect(() => supabaseTransport(fetcher)).toThrow("Invalid private");
  });
  it("preserves the cloud default without initializing a private adapter", () => {
    vi.stubEnv("SUPABASE_INTERNAL_URL", ""); const fetcher = vi.fn<typeof fetch>();
    expect(supabaseTransport(fetcher)).toBe(fetcher);
  });
});

describe("bounded anonymous homepage hash cache", () => {
  const policy = "default-src 'self'; script-src 'self' 'nonce-YWJj' 'strict-dynamic' https://www.googletagmanager.com; script-src-attr 'none'; style-src-elem 'self' 'nonce-YWJj'; frame-ancestors 'none'; object-src 'none'";
  it("excludes every private, query, API, RSC, action and prefetch variant", () => {
    expect(cacheableHomepage("GET", "/", { accept: "text/html" }, true)).toBe(true);
    for (const header of ["cookie", "authorization", "rsc", "next-action", "next-router-state-tree", "next-router-prefetch", "next-url", "range", "purpose"]) {
      expect(cacheableHomepage("GET", "/", { accept: "text/html", [header]: "anything" }, true)).toBe(false);
    }
    for (const path of ["/?q=test", "/dashboard", "/api/jobs/search", "/jobs"]) expect(cacheableHomepage("GET", path, { accept: "text/html" }, true)).toBe(false);
    expect(cacheableHomepage("POST", "/", { accept: "text/html" }, true)).toBe(false);
    expect(cacheableHomepage("GET", "/", { accept: "text/html" }, false)).toBe(false);
  });
  it("hashes exact original nonce-authorized bytes only, NEVER an injected script or a reusable nonce", () => {
    const trusted = 'self.__next_f.push([1,"hello"])'; const injected = "alert('xss')";
    const html = `<html><body><script nonce="YWJj">${trusted}</script><script>${injected}</script><style nonce="YWJj">p{color:red}</style></body></html>`;
    const result = hashedPublicPolicy(html, policy, "https://staging.ir35careers.com");
    const hash = (s: string) => createHash("sha256").update(s).digest("base64");
    expect(result).toContain(`'sha256-${hash(trusted)}'`);
    expect(result).toContain(`'sha256-${hash("p{color:red}")}'`);
    expect(result).not.toContain(hash(injected));
    expect(result).not.toMatch(/nonce-|strict-dynamic|unsafe-inline|unsafe-eval/);
    expect(result).toContain("https://staging.ir35careers.com/_next/static/");
    expect(result).toContain("frame-ancestors 'none'");
    expect(policy).toContain("'nonce-YWJj' 'strict-dynamic'"); // private original untouched
    expect(() => hashedPublicPolicy("<html>partial", policy, "https://staging.ir35careers.com")).toThrow();
  });
  it("bounds memory and TTL, denies Set-Cookie/compressed bodies and clock reversal", () => {
    const cache = new HomepageCache(); expect(cache.get(0)).toBeNull();
    expect(cache.put(Buffer.from("html"), {}, 100)).toBe(true);
    expect(cache.get(99)).toBeNull(); expect(cache.get(60_099)?.body.toString()).toBe("html");
    expect(cache.get(60_100)).toBeNull();
    expect(cache.put(Buffer.from("private"), { "set-cookie": ["session=private"] })).toBe(false);
    expect(cache.put(Buffer.from("zip"), { "content-encoding": "gzip" })).toBe(false);
    expect(cache.put(Buffer.alloc(4_000_001), {})).toBe(false);
  });
});

describe("truthful read-only stack health", () => {
  it("never invents a worker/realtime PASS when they are not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://staging.ir35careers.com/supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-only"); vi.stubEnv("SUPABASE_INTERNAL_URL", "http://ir35-p5-kong:8000");
    vi.stubEnv("IR35_WORKER_HEALTH_ENABLED", "false"); vi.stubEnv("IR35_REALTIME_HEALTH_ENABLED", "false");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
    const report = await stackHealth(fetcher);
    expect(report).toMatchObject({ ok: false, checks: { database: "ready", auth: "ready", storage: "ready", realtime: "not-configured", worker: "not-configured" } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(report)).not.toContain("test-only");
  });
  it("contains network failures without URLs/secrets or a false ready state", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://public.test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "credential-sentinel"); vi.stubEnv("SUPABASE_INTERNAL_URL", "");
    const report = await stackHealth(vi.fn<typeof fetch>().mockRejectedValue(new Error("credential-sentinel https://private.invalid")));
    expect(report.ok).toBe(false); expect(report.checks.database).toBe("unavailable");
    expect(JSON.stringify(report)).not.toMatch(/credential-sentinel|private.invalid/);
  });
});

describe("SSR search boundary", () => {
  it("forwards only public scalar filters and preserves filters/pagination", () => {
    expect(publicSearchParams({ q: "AWS", ir35: "outside", sort: "rate_high", page: "2", secret: "ignored", skills: ["bad", "array"] }).toString())
      .toBe("q=AWS&ir35=outside&sort=rate_high&page=2&per_page=12");
    expect(initialJobSearchSchema.safeParse({ jobs: [], total: 0, page: 1, per_page: 12 }).success).toBe(true);
    expect(initialJobSearchSchema.safeParse({ jobs: [{ id: "private" }], total: 1, page: 1, per_page: 12 }).success).toBe(false);
  });
});
