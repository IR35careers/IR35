import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/verification/oracle_schema_catalog.sql", import.meta.url), "utf8");
type Entry = { kind: string; name: string; hash: string; value: Record<string, unknown> };
describe("expanded read-only Oracle schema catalog", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
  });
  it("executes real catalog SQL and detects grants, both policy predicates and sequence definitions", async () => {
    try {
      await db.exec(`CREATE ROLE fixture_reader; CREATE TABLE public.fixture(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, dropped text, label text DEFAULT 'example');
        ALTER TABLE public.fixture DROP COLUMN dropped;
        ALTER TABLE public.fixture ENABLE ROW LEVEL SECURITY; ALTER TABLE public.fixture FORCE ROW LEVEL SECURITY;
        CREATE POLICY fixture_policy ON public.fixture TO fixture_reader USING (id > 0) WITH CHECK (id < 100);
        GRANT SELECT(label) ON public.fixture TO fixture_reader;`);
      await db.exec("CREATE TABLE public.fixture_with_long_name_for_catalog_composite_keys(id integer); GRANT SELECT ON public.fixture_with_long_name_for_catalog_composite_keys TO fixture_reader;");
      const catalog = async () => {
        await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;");
        const result = await db.query<{ catalog: { objects: Entry[] } }>(sql);
        await db.exec("ROLLBACK");
        return result.rows[0].catalog.objects;
      };
      const before = await catalog();
      expect(new Set(before.map(x => `${x.kind}:${x.name}`)).size).toBe(before.length);
      expect(before.some(x => x.kind === "grant" && x.name.length > 63)).toBe(true);
      expect(before.find(x => x.kind === "column" && x.name.endsWith(".label"))?.value.position).toBe(2);
      expect(before.find(x => x.kind === "policy")?.value).toMatchObject({ using: "(id > 0)", check: "(id < 100)" });
      expect(before.some(x => x.kind === "grant" && x.name.includes("fixture_reader"))).toBe(true);
      expect(before.some(x => x.kind === "constraint")).toBe(true);
      expect(before.some(x => x.kind === "index")).toBe(true);
      expect(before.some(x => x.kind === "sequence")).toBe(true);
      expect(before.find(x => x.kind === "rls")?.value).toEqual({ enabled: true, forced: true });
      await db.exec("ALTER POLICY fixture_policy ON public.fixture WITH CHECK (id < 50);");
      const after = await catalog();
      expect(after.find(x => x.kind === "policy")?.hash).not.toBe(before.find(x => x.kind === "policy")?.hash);
      expect(sql).not.toMatch(/rolpassword|encrypted_password|SELECT\s+\*\s+FROM\s+auth\.users/i);
    } finally { await db.close(); }
  });
});
