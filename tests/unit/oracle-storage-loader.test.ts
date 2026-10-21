import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("syntax-checks the exact image metadata loader without running it or connecting to a DB", () => {
  const source = readFileSync(new URL("../../infra/oracle/storage_diagnose.py", import.meta.url), "utf8");
  const literal = source.match(/^MIGRATION_JS = (".*")$/m)?.[1];
  expect(literal).toBeDefined();
  const script: unknown = JSON.parse(literal!);
  expect(typeof script).toBe("string");
  execFileSync(process.execPath, ["--check"], { input: String(script), stdio: ["pipe", "pipe", "pipe"] });
  expect(script).toContain("loadMigrationFiles");
  expect(script).not.toMatch(/connectionString|DATABASE_URL|Client\(/);
});
