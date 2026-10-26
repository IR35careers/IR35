import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedMockRequest, browserEnvironment, mockSignature, mockOptions } from "../../services/application-worker/mock-runtime";
const dns = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: dns }));
const fixture = "public-test-fixture-not-an-operational-secret";
const environment = () => ({ APPLY_RUNNER: "mock", IR35_STAGING: "true", APPLICATION_WORKER_SECRET: fixture,
  IR35CAREERS_APP_URL: "https://staging.ir35careers.com", QUEUE_DB_ALLOWED_HOSTS: "db",
  PG_BOSS_DATABASE_URL: `postgresql://ir35_queue:${fixture}@db:5432/postgres`,
  PG_BOSS_PRODUCER_DATABASE_URL: `postgresql://ir35_queue_producer:${fixture}@db:5432/postgres` });
afterEach(() => vi.resetAllMocks());

describe("mock worker credential and control-plane boundaries", () => {
  it("browser child receives no DB, HMAC, provider, proxy or Supabase values", () => {
    const input = { ...environment(), PGHOST: "db", PGPASSWORD: fixture, SUPABASE_SECRET_KEY: fixture, HTTP_PROXY: fixture,
      PATH: "safe-path", HOME: "/tmp/ir35-home", NODE_ENV: "production", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" };
    expect(browserEnvironment(input)).toEqual({ PATH: "safe-path", HOME: "/tmp/ir35-home", NODE_ENV: "production", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" });
    expect(JSON.stringify(browserEnvironment(input))).not.toContain(fixture);
  });
  it("requires exact owner/producer logins and pins private DNS for both", async () => {
    dns.mockResolvedValue([{ address: "172.18.0.2", family: 4 }]);
    expect(await mockOptions("setup", environment())).toMatchObject({ migrate: true, supervise: false, registerInstance: false });
    expect(await mockOptions("worker", environment())).toMatchObject({ migrate: false, supervise: true, max: 2 });
    expect(await mockOptions("producer", environment())).toMatchObject({ migrate: false, supervise: false, registerInstance: false, max: 1 });
    await expect(mockOptions("producer", { ...environment(), PG_BOSS_PRODUCER_DATABASE_URL: environment().PG_BOSS_DATABASE_URL })).rejects.toThrow("Wrong isolated queue identity");
  });
  it("signatures bind method, exact path, body and timestamp, not production callbacks", () => {
    const time = 1_792_800_000_000, timestamp = String(time), body = '{"action":"pause"}', path = "/mock/maintenance";
    const signature = mockSignature(fixture, timestamp, "POST", path, body);
    expect(authenticatedMockRequest(fixture, timestamp, signature, "POST", path, body, time)).toBe(true);
    for (const args of [[timestamp, signature, "GET", path, body, time], [timestamp, signature, "POST", path + "/", body, time],
      [timestamp, signature, "POST", path, "{}", time], [timestamp, signature, "POST", path, body, time + 30_001],
      [timestamp, "bad", "POST", path, body, time]] as const) {
      expect(authenticatedMockRequest(fixture, args[0], args[1], args[2], args[3], args[4], args[5])).toBe(false);
    }
  });
});
