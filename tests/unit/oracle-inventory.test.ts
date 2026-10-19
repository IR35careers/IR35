import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { assertPublicRls, parseOracleInventory, scanMigrationSource, summarizeConfigPull, summarizeVercelProject } from "../../infra/oracle/inventory";

const table = { schema: "public", name: "fixture", rls: true, force_rls: false,
  is_partition: false, bytes: 0, rows: 0 };
const inventory = { catalogVersion: 1, checkedAt: "2026-10-19T00:00:00Z", serverVersion: "17.6",
  databaseBytes: 100, schemas: ["public"], extensions: [], tables: [table], policies: [],
  functions: [], triggers: [], buckets: [], identityProvidersInUse: [], publications: [], migrationVersions: [] };

describe("Oracle metadata-only inventory", () => {
  it("accepts the CLI envelope but drops its unrelated fields", () => {
    expect(parseOracleInventory({ boundary: "fixture", warning: "untrusted", rows: [{ inventory }] })).toEqual(inventory);
  });
  it("rejects unknown database fields instead of publishing them", () => {
    const value = { ...inventory, private_material: "do-not-serialize-this-fixture" };
    expect(() => parseOracleInventory({ rows: [{ inventory: value }] })).toThrow("raw data");
    try { parseOracleInventory({ rows: [{ inventory: value }] }); }
    catch (error) { expect(String(error)).not.toContain("do-not-serialize"); }
  });
  it.each([NaN, -1, Number.MAX_SAFE_INTEGER + 1])("rejects invalid counts %s", rows => {
    expect(() => parseOracleInventory({ rows: [{ inventory: { ...inventory, tables: [{ ...table, rows }] } }] })).toThrow();
  });
  it("rejects empty or ambiguous envelopes and absent public evidence", () => {
    for (const rows of [[], [{ inventory }, { inventory }]]) expect(() => parseOracleInventory({ rows })).toThrow();
    expect(() => assertPublicRls([])).toThrow("incomplete");
    expect(() => assertPublicRls([{ ...table, schema: "auth" }])).toThrow("incomplete");
  });
  it("fails for every disabled public table, including extension-owned tables", () => {
    expect(() => assertPublicRls([{ ...table, rls: false }])).toThrow("disabled");
    expect(() => assertPublicRls([table, { ...table, name: "extension_fixture", rls: false }])).toThrow("disabled");
    expect(() => assertPublicRls([table, { ...table, schema: "auth", rls: false }])).not.toThrow();
  });
  it("executes the RLS regression against real disposable PostgreSQL", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE TABLE public.fixture(id int);");
      const read = () => db.query("SELECT 'public' AS schema, relname AS name, relrowsecurity AS rls, relforcerowsecurity AS force_rls, relispartition AS is_partition, 0 AS bytes, 0 AS rows FROM pg_class WHERE oid='public.fixture'::regclass");
      const before = await read();
      expect(() => assertPublicRls(before.rows)).toThrow("disabled");
      await db.exec("ALTER TABLE public.fixture ENABLE ROW LEVEL SECURITY;");
      const after = await read();
      expect(() => assertPublicRls(after.rows)).not.toThrow();
    } finally { await db.close(); }
  });
  it("keeps the production inventory transaction read-only and definitions hashed", () => {
    const sql = readFileSync(new URL("../../supabase/verification/oracle_inventory_readonly.sql", import.meta.url), "utf8");
    expect(sql).toContain("ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(sql).toContain("ROLLBACK;");
    expect(sql).not.toMatch(/\b(?:CREATE|INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i);
    expect(sql).toContain("md5(pg_get_functiondef");
    expect(sql).toContain("nspname !~ '^pg_'"); // pgboss is not a pg_ system schema.
    expect(sql).not.toContain("NOT LIKE 'pg_%'");
    expect(sql).not.toMatch(/encrypted_password|raw_app_meta_data|refresh_token|decrypted_secret|select\s+\*/i);
  });
  it("summarizes only a non-writing config dry-run without secret values", () => {
    const value = { dry_run: true, wrote: false, changes: [
      { path: ["auth", "external", "google"], remote: { enabled: true, secret: "never-serialize-this-fixture" } },
      { path: "auth.email.template.confirmation.content", remote: "<html>synthetic fixture</html>" },
    ] };
    const result = summarizeConfigPull(value);
    expect(result.fields).toContainEqual({ field: "auth.external.google.enabled", type: "boolean", value: true });
    expect(JSON.stringify(result)).not.toContain("never-serialize");
    expect(JSON.stringify(result)).not.toContain("<html>");
    expect(result.fields.some(field => field.htmlSha256?.length === 64)).toBe(true);
    expect(() => summarizeConfigPull({ ...value, wrote: true })).toThrow();
    expect(() => summarizeConfigPull({ ...value, dry_run: false })).toThrow();
  });
  it("inventories environment names and source locations, never their values", () => {
    const result = scanMigrationSource({
      "src/example.ts": "const key=process.env.PRIVATE_FIXTURE; const host=process.env['PUBLIC_FIXTURE']; import('@vercel/queue');",
      ".env.example": "PRIVATE_FIXTURE=never-serialize-this-fixture\nPUBLIC_FIXTURE=another-fixture",
      "scripts/fixture.sh": "echo ${SHELL_LOCAL_NOT_ENV}",
    });
    expect(result.environmentNames.map(row => row.name)).toEqual(["PRIVATE_FIXTURE", "PUBLIC_FIXTURE"]);
    expect(result.features).toContainEqual({ file: "src/example.ts", line: 1, feature: "vercel-runtime-import" });
    expect(JSON.stringify(result)).not.toContain("never-serialize");
    expect(() => scanMigrationSource({ "../unsafe?": "fixture" })).toThrow();
  });
  it("projects Vercel metadata without environment values or arbitrary response fields", () => {
    const value = { name: "fixture", framework: "nextjs", nodeVersion: "24.x", link: { productionBranch: "main" },
      crons: { enabledAt: 1, disabledAt: null, definitions: [{ path: "/api/fixture", schedule: "0 6 * * *" }] },
      targets: { production: { id: "dpl_fixture", meta: { githubCommitSha: "a".repeat(40), githubCommitRef: "main" } } },
      env: [{ key: "PRIVATE_FIXTURE", target: ["production"], type: "sensitive", value: "never-serialize-this-fixture" }],
      extraPrivateData: "never-serialize-this-fixture" };
    const result = summarizeVercelProject(value);
    expect(result.environmentNames[0].name).toBe("PRIVATE_FIXTURE");
    expect(JSON.stringify(result)).not.toContain("never-serialize");
    expect(() => summarizeVercelProject({ ...value, framework: "wrong" })).toThrow("suppressed");
  });
});
