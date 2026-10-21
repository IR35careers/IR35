import { z } from "zod";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const md5 = z.string().regex(/^[a-f0-9]{32}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.string().regex(/^(0|[1-9][0-9]*)$/);
const object = z.strictObject({ kind: z.string().min(1), name: z.string().min(1), hash: md5 });
const table = z.strictObject({ name: z.string().min(1), algorithm: z.literal("pg17-copy-binary-framed-text-v1"), rows: count, md5, serializedBytes: count });
const sequence = z.strictObject({ name: z.string().min(1), lastValue: z.string().regex(/^-?[0-9]+$/), isCalled: z.boolean() });
const storageObject = z.strictObject({ pathHash: sha256, bytes: count, sha256 });
const bucket = z.strictObject({ name: z.string().min(1), restrictionsMD5: md5, objects: z.array(storageObject), objectCount: count, totalBytes: count });
export const migrationManifestSchema = z.strictObject({
  version: z.literal(1), checkedAt: z.string().datetime(), serverMajor: z.literal(17),
  encoding: z.literal("UTF8"), collationHash: md5, unicodeRoundTripMD5: md5,
  catalog: z.array(object).min(1), tables: z.array(table).min(1), sequences: z.array(sequence),
  storage: z.array(bucket).min(1), largeObjectCount: z.literal("0"),
  complete: z.literal(true), snapshotBound: z.literal(true), sequenceStable: z.literal(true), storageStable: z.literal(true),
});
export type MigrationManifest = z.infer<typeof migrationManifestSchema>;

function unique<T>(items: T[], key: (row: T) => string) {
  const map = new Map<string, T>();
  for (const item of items) {
    const name = key(item);
    if (map.has(name)) throw new Error("Duplicate migration manifest key; no PASS");
    map.set(name, item);
  }
  return map;
}

export function compareMigration(sourceInput: unknown, targetInput: unknown) {
  const source = migrationManifestSchema.parse(sourceInput);
  const target = migrationManifestSchema.parse(targetInput);
  const failures: string[] = [];
  const compare = <T>(label: string, a: T[], b: T[], key: (row: T) => string) => {
    const left = unique(a, key), right = unique(b, key);
    for (const name of new Set([...left.keys(), ...right.keys()])) {
      if (JSON.stringify(left.get(name)) !== JSON.stringify(right.get(name))) failures.push(`${label}:${name}`);
    }
    return left.size;
  };
  for (const key of ["encoding", "collationHash", "unicodeRoundTripMD5", "serverMajor", "largeObjectCount"] as const) {
    if (source[key] !== target[key]) failures.push(`metadata:${key}`);
  }
  // Conditional extension-owner acceptance happens in the independent fidelity
  // gate, never here. Pass its reviewed normalized catalog hashes or exact ones.
  const objects = compare("schema", source.catalog, target.catalog, row => `${row.kind}:${row.name}`);
  const tables = compare("table", source.tables, target.tables, row => row.name);
  const sequences = compare("sequence", source.sequences, target.sequences, row => row.name);
  const validateBuckets = (input: MigrationManifest) => input.storage.map(value => {
    const objects = unique(value.objects, row => row.pathHash);
    const bytes = [...objects.values()].reduce((total, row) => total + BigInt(row.bytes), BigInt(0));
    if (BigInt(value.objectCount) !== BigInt(objects.size) || BigInt(value.totalBytes) !== bytes) throw new Error("Storage manifest count/bytes inconsistent; no PASS");
    return { ...value, objects: [...objects.values()].sort((a, b) => a.pathHash.localeCompare(b.pathHash)) };
  });
  const buckets = compare("bucket", validateBuckets(source), validateBuckets(target), row => row.name);
  const authTables = source.tables.filter(row => row.name.startsWith("auth.")).length;
  if (!source.tables.some(row => row.name === "auth.users") || !source.tables.some(row => row.name === "auth.identities") ||
      !source.tables.some(row => row.name === "auth.mfa_factors") || !source.tables.some(row => row.name === "storage.objects")) {
    failures.push("coverage:Auth/MFA/Storage tables missing");
  }
  return { status: failures.length ? "FAIL" as const : "PASS" as const, objects, tables, sequences, buckets, authTables, failures,
    sourceCheckedAt: source.checkedAt, targetCheckedAt: target.checkedAt, sourceWrites: 0, phaseComplete: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).join(" ") !== "--stdin") throw new Error("Explicit hash-manifest stdin required");
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.from(chunk); bytes += buffer.byteLength;
      if (bytes > 16_000_000) throw new Error("Manifest input bound");
      chunks.push(buffer);
    }
    const input = z.strictObject({ source: migrationManifestSchema, target: migrationManifestSchema }).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const result = compareMigration(input.source, input.target);
    console.log(JSON.stringify(result));
    if (result.status !== "PASS") process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ status: "FAIL", code: "INVALID_OR_INCOMPLETE_MANIFEST", rawInput: "withheld", phaseComplete: false }));
    process.exitCode = 1;
  }
}
