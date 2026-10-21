import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/verification/oracle_effective_privileges.sql", import.meta.url), "utf8");
type Entry = { kind: string; name: string; role: string; privileges: Record<string, boolean> };
it("checks actual inherited table/function privileges for all three roles, not just ACL text", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE fixture_reader;
      CREATE TABLE public.fixture(id integer); ALTER TABLE public.fixture ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION public.fixture_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1'; REVOKE ALL ON FUNCTION public.fixture_fn() FROM PUBLIC;
      GRANT fixture_reader TO authenticated; GRANT SELECT ON public.fixture TO fixture_reader; GRANT EXECUTE ON FUNCTION public.fixture_fn() TO service_role;`);
    const matrix = async () => {
      await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;");
      const result = await db.query<{ privileges: { entries: Entry[] } }>(sql);
      await db.exec("ROLLBACK");
      return result.rows[0].privileges.entries;
    };
    const before = await matrix();
    const row = (entries: Entry[], name: string, role: string) => entries.find(x => x.name === name && x.role === role)!;
    expect(row(before, "public.fixture", "authenticated").privileges.SELECT).toBe(true);
    expect(row(before, "public.fixture", "anon").privileges.SELECT).toBe(false);
    expect(row(before, "public.fixture_fn()", "service_role").privileges.EXECUTE).toBe(true);
    expect(row(before, "public.fixture_fn()", "anon").privileges.EXECUTE).toBe(false);
    await db.exec("GRANT SELECT ON public.fixture TO anon; GRANT EXECUTE ON FUNCTION public.fixture_fn() TO anon;");
    const after = await matrix();
    expect(row(after, "public.fixture", "anon").privileges.SELECT).toBe(true);
    expect(row(after, "public.fixture_fn()", "anon").privileges.EXECUTE).toBe(true);
    expect(sql).not.toMatch(/rolpassword|encrypted_password|SELECT\s+\*\s+FROM\s+auth\.users/i);
  } finally { await db.close(); }
});
