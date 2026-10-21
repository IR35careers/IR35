import { readSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublicRls, parseOracleInventory } from "../infra/oracle/inventory";

/** stdin is the metadata-only SQL response, never a dump or provider config. */
export function main(args: string[]) {
  if (args.length > 1 || (args.length === 1 && !["--check-rls", "--save-report", "--save-p3"].includes(args[0])))
    throw new Error("Usage: SQL metadata JSON on stdin; optional --check-rls, --save-report or --save-p3. No cloud writes.");
  const raw = Buffer.alloc(4_000_001);
  let length = 0;
  while (length < raw.length) {
    const received = readSync(0, raw, length, raw.length - length, null);
    if (received === 0) break;
    length += received;
  }
  if (length > 4_000_000) throw new Error("Inventory exceeds the bounded input size.");
  const inventory = parseOracleInventory(JSON.parse(raw.subarray(0, length).toString("utf8")));
  if (args[0] === "--check-rls") {
    assertPublicRls(inventory.tables);
    console.log(JSON.stringify({ publicRls: "pass", publicTables: inventory.tables.filter(row => row.schema === "public").length }));
  } else if (args[0] === "--save-report" || args[0] === "--save-p3") {
    const target = new URL(args[0] === "--save-p3" ? "../docs/evidence/oracle-p3-source-catalog.json" : "../docs/oracle-migration-inventory.json", import.meta.url);
    // This fixed-path, schema-validated metadata report is intentionally regenerated.
    writeFileSync(target, `${JSON.stringify(inventory, null, 2)}\n`);
    console.log(JSON.stringify({ saved: args[0] === "--save-p3" ? "docs/evidence/oracle-p3-source-catalog.json" : "docs/oracle-migration-inventory.json", checkedAt: inventory.checkedAt,
      serverVersion: inventory.serverVersion, databaseBytes: inventory.databaseBytes,
      tables: inventory.tables.length, policies: inventory.policies.length, functions: inventory.functions.length,
      triggers: inventory.triggers.length, publicRlsDisabled: inventory.tables.filter(row => row.schema === "public" && !row.rls).map(row => row.name) }));
  } else console.log(JSON.stringify(inventory, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch { console.error("Oracle inventory/RLS check failed. Raw input and secrets suppressed; no database changes."); process.exitCode = 1; }
}
