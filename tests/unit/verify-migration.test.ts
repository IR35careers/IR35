import { expect, it } from "vitest";
import { compareMigration, migrationManifestSchema } from "../../scripts/verify-migration";

function manifest() {
  return migrationManifestSchema.parse({ version: 1, checkedAt: "2026-10-21T09:00:00Z", serverMajor: 17, encoding: "UTF8", collationHash: "a".repeat(32), unicodeRoundTripMD5: "b".repeat(32),
    catalog: [{ kind: "policy", name: "public.fixture.owner", hash: "a".repeat(32) }],
    tables: ["auth.users", "auth.identities", "auth.mfa_factors", "storage.objects"].map(name => ({ name, algorithm: "pg17-copy-binary-framed-text-v1", rows: "1", md5: "c".repeat(32), serializedBytes: "20" })),
    sequences: [{ name: "public.fixture_id_seq", lastValue: "9223372036854775806", isCalled: false }],
    storage: [{ name: "private", restrictionsMD5: "d".repeat(32), objectCount: "1", totalBytes: "4", objects: [{ pathHash: "a".repeat(64), bytes: "4", sha256: "b".repeat(64) }] }],
    largeObjectCount: "0", complete: true, snapshotBound: true, sequenceStable: true, storageStable: true });
}

it("requires exact table/Auth/sequence/schema/storage equality and complete coverage", () => {
  const source = manifest();
  expect(compareMigration(source, manifest()).status).toBe("PASS");
  for (const mutate of [
    (x: typeof source) => { x.tables[0].md5 = "e".repeat(32); },
    (x: typeof source) => { x.tables[0].rows = "2"; },
    (x: typeof source) => { x.sequences[0].isCalled = true; },
    (x: typeof source) => { x.sequences[0].lastValue = "9223372036854775807"; },
    (x: typeof source) => { x.catalog[0].hash = "f".repeat(32); },
    (x: typeof source) => { x.storage[0].objects[0].sha256 = "c".repeat(64); },
    (x: typeof source) => { x.tables.pop(); },
    (x: typeof source) => { x.storage[0].restrictionsMD5 = "e".repeat(32); },
  ]) {
    const target = structuredClone(source); mutate(target);
    expect(compareMigration(source, target).status).toBe("FAIL");
  }
  const duplicate = structuredClone(source); duplicate.tables.push(duplicate.tables[0]);
  expect(() => compareMigration(source, duplicate)).toThrow(/Duplicate/);
  const incomplete = structuredClone(source); incomplete.storage[0].objectCount = "2";
  expect(() => compareMigration(source, incomplete)).toThrow(/inconsistent/);
  expect(() => compareMigration({ ...source, complete: false }, source)).toThrow();
  expect(() => compareMigration({ ...source, rawPassword: "not allowed" }, source)).toThrow();
  const uncovered = structuredClone(source); uncovered.tables = uncovered.tables.filter(row => row.name !== "auth.mfa_factors");
  expect(compareMigration(uncovered, uncovered).status).toBe("FAIL");
});
