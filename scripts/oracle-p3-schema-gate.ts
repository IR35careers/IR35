import { readFileSync, readSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const objectSchema = z.strictObject({ kind: z.enum(["column", "function", "policy", "trigger", "rls"]), name: z.string().min(1).max(1000), hash: z.string().regex(/^[a-f0-9]{32}$/) });
export const p3CatalogSchema = z.strictObject({ scope: z.string(), checkedAt: z.iso.datetime(), serverVersion: z.string(), objects: z.array(objectSchema).max(5000) });

export function compareP3Schema(sourceInput: unknown, targetInput: unknown) {
  const source = p3CatalogSchema.parse(sourceInput), target = p3CatalogSchema.parse(targetInput);
  const index = (catalog: z.infer<typeof p3CatalogSchema>) => {
    const map = new Map<string, z.infer<typeof objectSchema>>();
    for (const object of catalog.objects) {
      const key = `${object.kind}:${object.name}`;
      if (map.has(key)) throw new Error("Duplicate schema object; comparison refused.");
      map.set(key, object);
    }
    return map;
  };
  const from = index(source), to = index(target);
  const differences = [];
  for (const key of [...new Set([...from.keys(), ...to.keys()])].sort()) {
    const a = from.get(key), b = to.get(key);
    if (a?.hash !== b?.hash) differences.push({ object: key, sourceHash: a?.hash ?? null, targetHash: b?.hash ?? null });
  }
  return { status: differences.length ? "FAIL" : "SUBSET_MATCH_ONLY", fullVerification: false, sourceCheckedAt: source.checkedAt, targetCheckedAt: target.checkedAt, sourceObjects: from.size, targetObjects: to.size, differences };
}

function main() {
  if (process.argv.slice(2).join(" ") !== "--source-stdin") throw new Error("Use --source-stdin; fixed read-only catalog paths only.");
  const buffer = Buffer.alloc(2_000_001);
  let length = 0;
  while (length < buffer.length) { const count = readSync(0, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
  if (length > 2_000_000) throw new Error("Catalog exceeds bound.");
  const envelope = z.object({ rows: z.array(z.strictObject({ schema_catalog: p3CatalogSchema })).length(1) }).parse(JSON.parse(buffer.subarray(0, length).toString("utf8")));
  const source = envelope.rows[0].schema_catalog;
  const target = p3CatalogSchema.parse(JSON.parse(readFileSync(new URL("../docs/evidence/oracle-p3-target-schema.json", import.meta.url), "utf8")));
  const result = compareP3Schema(source, target);
  writeFileSync(new URL("../docs/evidence/oracle-p3-source-schema.json", import.meta.url), JSON.stringify(source, null, 2) + "\n");
  writeFileSync(new URL("../docs/evidence/oracle-p3-schema-gate.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ status: result.status, fullVerification: false, sourceObjects: result.sourceObjects, targetObjects: result.targetObjects, differences: result.differences.length }));
  if (result.status === "FAIL") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { console.error("P3 schema gate failed; raw input suppressed. No database writes."); process.exitCode = 1; }
}
