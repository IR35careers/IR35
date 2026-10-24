import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queueDatabaseConnection } from "@/lib/queue/database-connection";
// Exercise the prepared boundary directly until async queue wiring is integrated.
const pgBossOptions = (_mode: string, value: unknown) => queueDatabaseConnection(value, process.env.QUEUE_DB_ALLOWED_HOSTS);
import { PgBoss } from "pg-boss";

const dns = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ address: string; family: number }[]>>());
vi.mock("node:dns/promises", () => ({ lookup: dns }));
const password = "never-echo-this-private-password";
const url = (host: string, query = "") => `postgresql://ir35_queue:${password}@${host}:5432/postgres${query}`;
beforeEach(() => {
  vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", "");
  vi.stubEnv("PG_BOSS_SSL_CA", undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); vi.useRealTimers(); });

describe("queue database host and TLS boundary", () => {
  it.each(["", "?sslmode=require", "?sslmode=disable", "?sslmode=no-verify&sslrootcert=/untrusted"])("preserves verified TLS for the existing Supabase session pooler (%s)", async query => {
    const options = await pgBossOptions("producer", url("aws-0-eu-west-2.pooler.supabase.com", query));
    expect(options.ssl).toEqual({ rejectUnauthorized: true });
    expect(options.connectionString).not.toContain("?");
    expect(dns).not.toHaveBeenCalled();
  });
  it("resolves an exact allowlisted Docker name and pins the checked private address", async () => {
    vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", " db , db.staging.internal ");
    dns.mockResolvedValue([{ address: "172.18.0.2", family: 4 }]);
    const options = await pgBossOptions("worker", url("db"));
    expect(dns).toHaveBeenCalledExactlyOnceWith("db", { all: true, verbatim: true });
    expect(new URL(options.connectionString!).hostname).toBe("172.18.0.2");
    expect(options.ssl).toBe(false);
    // Exercise the actual library constructor without opening a connection.
    expect(() => new PgBoss(options)).not.toThrow();
    // The pool receives a numeric IP, so it cannot resolve db a second time.
  });
  it.each(["127.0.0.1", "127.12.3.4", "10.1.2.3", "172.16.0.2", "172.31.255.254", "192.168.1.2", "[::1]"])("allows explicitly listed private/loopback %s without TLS", async host => {
    vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", host.replace(/^\[|\]$/g, ""));
    const options = await pgBossOptions("setup", url(host, "?sslmode=disable"));
    expect(options.ssl).toBe(false);
    expect(dns).not.toHaveBeenCalled();
  });
  it.each(["db", "127.0.0.1", "localhost", "supabase.com", "aws.pooler.supabase.com.evil.test"])("rejects non-allowlisted %s before DNS", async host => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("PG_BOSS_LOCAL_TEST", "true");
    await expect(pgBossOptions("producer", url(host))).rejects.toThrow(`host ${host}:`);
    expect(dns).not.toHaveBeenCalled();
  });
  it.each(["*.internal", "db,*", "db,,localhost", "https://db", "db:5432", "db/path", "user:pass@db"])("rejects invalid/wildcard allowlist (%s)", async allowlist => {
    vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", allowlist);
    await expect(pgBossOptions("producer", url("db"))).rejects.toThrow("comma-separated exact hostnames");
    expect(dns).not.toHaveBeenCalled();
  });
  it.each(["203.0.113.5", "172.15.0.1", "172.32.0.1", "169.254.169.254", "0.0.0.0", "[::ffff:127.0.0.1]", "[2001:db8::1]"])("rejects public, link-local, unspecified or mapped %s without TLS", async host => {
    vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", new URL(url(host)).hostname.replace(/^\[|\]$/g, ""));
    await expect(pgBossOptions("worker", url(host))).rejects.toThrow("require sslmode=require");
  });
  it("rejects a mixed private/public DNS result instead of choosing the private answer", async () => {
    vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", "db");
    dns.mockResolvedValue([{ address: "172.18.0.2", family: 4 }, { address: "203.0.113.5", family: 4 }]);
    await expect(pgBossOptions("worker", url("db"))).rejects.toThrow("every resolved address");
  });
  it.each(["require", "verify-ca", "verify-full"])("requires verified TLS for an allowlisted public hostname (%s)", async mode => {
    vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", "api-staging.ir35careers.com");
    const options = await pgBossOptions("worker", url("api-staging.ir35careers.com", `?sslmode=${mode}&ssl=no-verify&sslrootcert=/untrusted`));
    expect(options.ssl).toEqual({ rejectUnauthorized: true });
    expect(new URL(options.connectionString!).hostname).toBe("api-staging.ir35careers.com");
    expect(options.connectionString).not.toContain("?");
  });
  it.each(["", "?sslmode=disable", "?sslmode=prefer", "?sslmode=require&sslmode=disable"])("rejects public hosts without unambiguous TLS (%s)", async query => {
    vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", "public.example.test");
    dns.mockResolvedValue([{ address: "203.0.113.5", family: 4 }]);
    await expect(pgBossOptions("worker", url("public.example.test", query))).rejects.toThrow(/sslmode/);
  });
  it("rejects failed/empty DNS with only a safe host-specific error", async () => {
    vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", "db");
    dns.mockRejectedValue(new Error(url("db")));
    let message = "";
    try { await pgBossOptions("worker", url("db")); } catch (error) { message = String(error); }
    expect(message).toContain("host db:");
    expect(message).not.toContain(password);
    expect(message).not.toContain("postgresql://");
    dns.mockResolvedValue([]);
    await expect(pgBossOptions("worker", url("db"))).rejects.toThrow("every resolved address");
  });
  it("bounds the DNS check without leaking resolver input", async () => {
    vi.useFakeTimers(); vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", "db");
    dns.mockReturnValue(new Promise(() => {}));
    const check = expect(pgBossOptions("worker", url("db"))).rejects.toThrow("host db:");
    await vi.advanceTimersByTimeAsync(5_000);
    await check;
  });
  it.each([
    "invalid-private-value", url("unlisted.example.test"),
    url("db").replace(":5432/", ":6543/"), url("db").replace("/postgres", "/other"),
    `${url("db")}#untrusted`, url("db").replace("postgresql:", "https:"),
  ])("redacts parser/validation failures", async connection => {
    vi.stubEnv("QUEUE_DB_ALLOWED_HOSTS", "db");
    let message = "";
    try { await pgBossOptions("producer", connection); } catch (error) { message = String(error); }
    expect(message).toContain("Queue database host");
    expect(message).not.toContain(password);
    expect(message).not.toContain("invalid-private-value");
    expect(message).not.toContain("postgresql://");
  });
});
