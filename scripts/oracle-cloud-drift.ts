import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{32}$/);
const objectSchema = z.strictObject({ kind: z.string().min(1).max(32), name: z.string().min(1).max(8192), hash,
  value: z.record(z.string(), z.unknown()).optional() });
export const catalogSchema = z.strictObject({ version: z.literal(1), checkedAt: z.iso.datetime(), serverVersion: z.string(), encoding: z.string(),
  collation: z.record(z.string(), z.unknown()), schemas: z.array(z.string()), objects: z.array(objectSchema).max(20000) });
const originalSchema = z.object({ differences: z.array(z.strictObject({ object: z.string(), sourceHash: hash.nullable(), targetHash: hash.nullable() })).length(77) });
type Catalog = z.infer<typeof catalogSchema>;
function index(catalog: Catalog) {
  const result = new Map<string, z.infer<typeof objectSchema>>();
  for (const object of catalog.objects) {
    const key = `${object.kind}:${object.name}`;
    if (result.has(key)) throw new Error("Duplicate catalog key; comparison invalid, never PASS.");
    result.set(key, object);
  }
  return result;
}
export function compareCloudClone(sourceInput: unknown, targetInput: unknown) {
  const source = catalogSchema.parse(sourceInput), target = catalogSchema.parse(targetInput);
  const a = index(source), b = index(target);
  const differences = [...new Set([...a.keys(), ...b.keys()])].sort().flatMap(key => {
    const from = a.get(key), to = b.get(key);
    return from?.hash === to?.hash ? [] : [{ object: key, cloudHash: from?.hash ?? null, cloneHash: to?.hash ?? null }];
  });
  const encodingMatch = source.encoding === target.encoding;
  const collationMatch = JSON.stringify(source.collation) === JSON.stringify(target.collation);
  return { status: differences.length || !encodingMatch || !collationMatch ? "FAIL" : "CATALOG_MATCH_ONLY", phaseComplete: false,
    sourceCheckedAt: source.checkedAt, targetCheckedAt: target.checkedAt, sourceObjects: a.size, targetObjects: b.size,
    encodingMatch, collationMatch, exceptions: [], differences,
    note: "No implicit exceptions. Data/sequence-state/storage byte verification is P4, not this catalog comparison." };
}
const securitySchema = z.object({ rolesMatch: z.boolean(), roleExpiry: z.object({ status: z.enum(["PASS", "FAIL"]),
  differences: z.array(z.strictObject({ role: z.string(), cloudHash: hash.nullable(), cloneHash: hash.nullable(),
    cloudFiniteExpiry: z.boolean(), cloneExpiryConfigured: z.boolean(), morePermissive: z.boolean() })) }),
  privileges: z.object({ status: z.enum(["PASS", "FAIL"]) }), publicTablesWithoutRLS: z.array(z.string()) });
export function combineCatalogSecurity(result: ReturnType<typeof compareCloudClone>, securityInput: unknown) {
  const security = securitySchema.parse(securityInput);
  const status = result.status === "CATALOG_MATCH_ONLY" && security.rolesMatch && security.roleExpiry.status === "PASS" &&
    !security.roleExpiry.differences.length && security.privileges.status === "PASS" && !security.publicTablesWithoutRLS.length ? "CATALOG_MATCH_ONLY" : "FAIL";
  return { ...result, status, roleAttributeDifferences: security.roleExpiry.differences,
    totalUnwaivedDifferences: result.differences.length + security.roleExpiry.differences.length,
    securityRepairHold: Boolean(security.roleExpiry.differences.length || security.privileges.status !== "PASS" || security.publicTablesWithoutRLS.length) };
}
export function originalDrift(originalInput: unknown, sourceInput: unknown, targetInput: unknown) {
  const original = originalSchema.parse(originalInput), source = index(catalogSchema.parse(sourceInput)), target = index(catalogSchema.parse(targetInput));
  return original.differences.map(row => {
    const [kind, ...parts] = row.object.split(":"), name = parts.join(":");
    const from = source.get(`${kind}:public.${name}`), to = target.get(`${kind}:public.${name}`);
    if (Boolean(row.sourceHash) !== Boolean(from) || Boolean(row.targetHash) !== Boolean(to)) throw new Error("Original drift presence changed; stop for new schema review.");
    const group = kind === "policy" || kind === "rls" ? "RLS" : kind === "grant" ? "grants" : kind === "function" ? "functions" : "other";
    const value = (entry: typeof from, digest: string | null) => entry ? { presence: "present", definitionMd5: digest,
      ...(entry.value ? { metadata: entry.value } : { plaintext: "withheld; exact original definition fingerprint shown" }) } : { presence: "absent" };
    return { group, object: row.object, cloud: value(from, row.sourceHash), repo: value(to, row.targetHash),
      securityReview: kind === "policy" ? "REVIEW: cloud-stricter possibility; effective USING/WITH CHECK policy-set implication is not automatically proven. Preserve cloud exactly, never broaden it." : null };
  });
}
function main() {
  if (process.argv.length !== 2) throw new Error("Fixed public metadata files only.");
  const file = (name: string) => new URL(`../docs/evidence/${name}`, import.meta.url);
  const read = (name: string) => JSON.parse(readFileSync(file(name), "utf8"));
  const cache = (name: string) => new URL(`../.cache/oracle-schema/${name}.json`, import.meta.url);
  const cached = (name: string) => JSON.parse(readFileSync(cache(name), "utf8"));
  const source = cached("source"), clone = cached("clone");
  const gate = compareCloudClone(source, clone);
  const rows = originalDrift(read("oracle-p3-schema-gate.json"), source, cached("repo-target"));
  const inputSHA256 = Object.fromEntries(["source", "clone", "repo-target"].map(name => [name, createHash("sha256").update(readFileSync(cache(name))).digest("hex")]));
  writeFileSync(file("oracle-p3-clone-gate.json"), JSON.stringify({ ...gate, inputSHA256 }, null, 2) + "\n");
  writeFileSync(file("oracle-p3-drift-77.json"), JSON.stringify({ originalDifferences: 77, groups: ["RLS", "grants", "functions", "other"],
    sourceCheckedAt: catalogSchema.parse(source).checkedAt, rows, note: "Original77 public subset had no grant coverage. Expanded clone gate now compares grants separately; zero original grant entries is not grant parity." }, null, 2) + "\n");
  let markdown = "# Original P3 drift — all77 differences\n\nCloud is authoritative. No production repair. Generated from schema metadata; function bodies stay private, exact MD5 fingerprints shown. Policy changes are conservatively security-flagged, not automatically declared safe.\n\n";
  const cell = (value: unknown) => JSON.stringify(value).replaceAll("|", "\\|").replaceAll("`", "\\`");
  for (const group of ["RLS", "grants", "functions", "other"]) {
    const selected = rows.filter(row => row.group === group);
    markdown += `## ${group} (${selected.length})\n\n`;
    if (!selected.length) { markdown += "Not covered by the original77-object subset; see the separate expanded clone gate. Not a PASS.\n\n"; continue; }
    markdown += "| Object | Cloud value/fingerprint | Repo-built value/fingerprint | Security review |\n| --- | --- | --- | --- |\n";
    for (const row of selected) markdown += `| ${cell(row.object)} | ${cell(row.cloud)} | ${cell(row.repo)} | ${row.securityReview ?? "—"} |\n`;
    markdown += "\n";
  }
  writeFileSync(file("oracle-p3-drift-77.md"), markdown.trimEnd() + "\n");
  console.log(JSON.stringify({ originalDriftEntries: rows.length, cloneGate: gate.status, cloneDifferences: gate.differences.length, sourceWrites: 0 }));
  if (gate.status === "FAIL") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { console.error("Cloud drift report refused invalid metadata; raw values withheld."); process.exitCode = 1; }
}
