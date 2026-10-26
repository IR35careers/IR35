import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_APPLY_QUEUE, MOCK_SCHEDULE_QUEUE, STAGING_TEST_ACCOUNT, mockApplicationWorkSchema,
  mockScheduledWorkSchema, mockWorkerConfig, mockQueueOptions } from "@/lib/queue/mock-config";

const dns = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ address: string; family: number }[]>>());
vi.mock("node:dns/promises", () => ({ lookup: dns }));
afterEach(() => { vi.resetAllMocks(); });
const privateFixture = "public-fixture-only-never-an-operational-password";
const configured = (): Record<string, string | undefined> => ({ APPLY_RUNNER: "mock", IR35_STAGING: "true",
  APPLICATION_WORKER_SECRET: "public-fixture-HMAC-not-a-real-secret", IR35CAREERS_APP_URL: "https://staging.ir35careers.com",
  PG_BOSS_DATABASE_URL: `postgresql://ir35_queue:${privateFixture}@db:5432/postgres`, QUEUE_DB_ALLOWED_HOSTS: "db" });

describe("P6 mock-only worker boundary (not a production acceptance switch)", () => {
  it("defaults to maintenance/one browser/real acceptance false and preserves input", () => {
    const input = configured(); const before = { ...input };
    expect(mockWorkerConfig(input)).toMatchObject({ APPLY_RUNNER: "mock", IR35_READ_ONLY: "true",
      APPLICATION_WORKER_ACCEPT_JOBS: "false", APPLICATION_WORKER_CONCURRENCY: "1", mockConsumerEnabled: false });
    expect(input).toEqual(before);
    expect(mockWorkerConfig({ ...input, IR35_READ_ONLY: "false" })).toMatchObject({ mockConsumerEnabled: true, APPLICATION_WORKER_ACCEPT_JOBS: "false" });
    expect(MOCK_APPLY_QUEUE).not.toBe("ir35-apply"); expect(MOCK_SCHEDULE_QUEUE).not.toBe("ir35-alerts");
  });

  it.each([
    ["APPLY_RUNNER", undefined], ["APPLY_RUNNER", "oracle"], ["APPLY_RUNNER", "railway"], ["APPLY_RUNNER", "vercel"],
    ["IR35_STAGING", "false"], ["IR35_STAGING", undefined], ["VERCEL", "1"],
    ["APPLICATION_WORKER_ACCEPT_JOBS", "true"], ["APPLICATION_WORKER_CONCURRENCY", "2"],
    ["IR35_READ_ONLY", "mistyped"], ["IR35_SCHEDULER_ENABLED", "true"],
    ["IR35CAREERS_APP_URL", "https://www.ir35careers.com"], ["IR35CAREERS_APP_URL", "https://staging.ir35careers.com/path"],
    ["IR35CAREERS_APP_URL", "https://staging.ir35careers.com?private-fixture"],
    ["APPLICATION_WORKER_SECRET", privateFixture.slice(0, 10)],
  ])("fails closed without printing rejected %s values", (key, value) => {
    let message = "";
    try { mockWorkerConfig({ ...configured(), [key]: value }); } catch (error) { message = String(error); }
    expect(message).toContain("Mock worker requires isolated staging"); expect(message).not.toContain(privateFixture);
    if (value?.startsWith("https:")) expect(message).not.toContain(value);
  });

  it.each(["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_INTERNAL_URL", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "OPENAI_API_KEY",
    "OPENROUTER_API_KEY", "AWS_ACCESS_KEY_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_TOKEN", "GH_TOKEN"])("rejects direct data/provider field %s before DNS", async key => {
    await expect(mockQueueOptions({ ...configured(), [key]: privateFixture })).rejects.toThrow("no direct data/provider credentials");
    expect(dns).not.toHaveBeenCalled();
  });

  it("uses validated private IP pinning, two DB connections and no auto-migrations", async () => {
    dns.mockResolvedValue([{ address: "172.18.0.7", family: 4 }]);
    const options = await mockQueueOptions(configured());
    expect(new URL(options.connectionString!).hostname).toBe("172.18.0.7");
    expect(options).toMatchObject({ ssl: false, max: 2, migrate: false, createSchema: false, schedule: false, schema: "pgboss" });
  });

  it("never allows a public Supabase database merely because verified TLS is valid", async () => {
    const input = { ...configured(), PG_BOSS_DATABASE_URL: `postgresql://ir35_queue:${privateFixture}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres` };
    await expect(mockQueueOptions(input)).rejects.toThrow("no public/cloud database");
    expect(dns).not.toHaveBeenCalled();
  });

  it("refuses mixed public/private DNS and missing exact allowlists", async () => {
    dns.mockResolvedValue([{ address: "172.18.0.7", family: 4 }, { address: "203.0.113.5", family: 4 }]);
    await expect(mockQueueOptions(configured())).rejects.toThrow("every resolved address");
    await expect(mockQueueOptions({ ...configured(), QUEUE_DB_ALLOWED_HOSTS: "" })).rejects.toThrow("exact QUEUE_DB_ALLOWED_HOSTS");
  });

  it("accepts only the named test actor and strict opaque mock work, never employer/credential payloads", () => {
    const input = { kind: "staging_mock_application", applicationId: "12345678-1234-4234-8234-123456789abc",
      actorEmail: STAGING_TEST_ACCOUNT, scenario: "success", requestedAt: "2026-10-24T12:00:00Z" };
    expect(mockApplicationWorkSchema.safeParse(input).success).toBe(true);
    expect(mockApplicationWorkSchema.safeParse({ ...input, actorEmail: "customer@invalid.test" }).success).toBe(false);
    for (const key of ["employerUrl", "password", "cv", "resume", "token"]) {
      expect(mockApplicationWorkSchema.safeParse({ ...input, [key]: privateFixture }).success).toBe(false);
    }
    expect(mockApplicationWorkSchema.safeParse({ ...input, kind: "real_application" }).success).toBe(false);
    expect(mockScheduledWorkSchema.safeParse({ kind: "staging_mock_schedule", operation: "mock_automation", requestedAt: input.requestedAt }).success).toBe(true);
    expect(mockScheduledWorkSchema.safeParse({ kind: "staging_mock_schedule", operation: "automation", requestedAt: input.requestedAt }).success).toBe(false);
  });
});
