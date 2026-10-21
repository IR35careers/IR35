import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/verification/oracle_transport_catalog.sql", import.meta.url), "utf8");
type ObjectHash = { kind: string; name: string; hash: string };
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
});

it("executes supplemental transport SQL and detects real type-ACL and publication changes without raw definitions", async () => {
  try {
    await db.exec("CREATE ROLE fixture_reader; CREATE TYPE public.fixture_kind AS ENUM ('safe'); CREATE TABLE public.fixture(id integer PRIMARY KEY); CREATE PUBLICATION fixture_pub FOR TABLE public.fixture;");
    const catalog = async () => {
      await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;");
      const result = await db.query<{ transport: { objects: ObjectHash[] } }>(sql);
      await db.exec("ROLLBACK");
      return result.rows[0].transport.objects;
    };
    const before = await catalog();
    expect(before.some(x => x.kind === "publication" && x.name === "fixture_pub")).toBe(true);
    expect(before.some(x => x.kind === "publication-table")).toBe(true);
    expect(before.every(x => Object.keys(x).sort().join(",") === "hash,kind,name")).toBe(true);
    await db.exec("GRANT USAGE ON TYPE public.fixture_kind TO fixture_reader; ALTER PUBLICATION fixture_pub DROP TABLE public.fixture;");
    const after = await catalog();
    expect(after.some(x => x.kind === "type-acl" && x.name.includes("fixture_reader"))).toBe(true);
    expect(before.some(x => x.kind === "type-acl" && x.name.includes("fixture_reader"))).toBe(false);
    expect(after.some(x => x.kind === "publication-table")).toBe(false);
    expect(sql).not.toMatch(/rolpassword|encrypted_password|SELECT\s+\*\s+FROM\s+auth\.users/i);
  } finally { await db.close(); }
});
