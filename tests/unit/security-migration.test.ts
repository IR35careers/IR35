import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.join(process.cwd(), "supabase", "migrations", "017_security_hardening.sql"), "utf8");

describe("production security migration", () => {
  it("makes private inbox aliases owner-read-only", () => {
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON inbox_aliases FROM authenticated");
  });

  it("prevents browsers from fabricating submitted packets and receipts", () => {
    expect(migration).toContain("status IN ('draft', 'ready', 'needs_review')");
    expect(migration).toContain("AND mode = 'dry_run'");
    expect(migration).toContain("AND receipt IS NULL");
    expect(migration).not.toMatch(/GRANT UPDATE \([\s\S]*?\breceipt\b[\s\S]*?\) ON application_packets TO authenticated/);
  });

  it("reserves delivery timeline events for trusted server routes", () => {
    expect(migration).toContain("event_type IN ('created', 'prepared', 'approved', 'note')");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON application_events FROM authenticated");
  });

  it("serialises durable rate limits without exposing the counter function to browsers", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("consume_security_rate_limit");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
  });
});
