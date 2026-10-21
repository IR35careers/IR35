import { readFileSync, readdirSync } from "node:fs";
import { z } from "zod";
import { expect, it } from "vitest";

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), "utf8"));
const exceptions = ["extension:pg_stat_statements", "extension:pgcrypto", "extension:uuid-ossp"];
const proof = z.object({ status: z.literal("PASS_WITH_OWNER_APPROVED_EXCEPTIONS"), sourceObjects: z.literal(3752), targetObjects: z.literal(3752),
  unexplainedDifferences: z.tuple([]), exceptions: z.array(z.object({ object: z.string() })).length(3), roleAttributesMatch: z.literal(true), metadataMatch: z.literal(true),
  fullDataVerification: z.literal(false), extensions: z.object({ status: z.literal("PASS"), objectACLChecks: z.literal(62), typeACLChecks: z.literal(4), capabilityChecks: z.literal(198),
    unapprovedDifferences: z.tuple([]), conditions: z.strictObject({ adminOwner: z.literal(true), allObjectACLs: z.literal(true), ddlCapabilities: z.literal(true), versions: z.literal(true) }) }),
  appRolePrivileges: z.object({ status: z.literal("PASS"), sourceEntries: z.literal(552), targetEntries: z.literal(552), differences: z.tuple([]), morePermissive: z.tuple([]) }) });

it("binds executable staging-only baseline to both actual native fresh proofs, not historical failed evidence", () => {
  const manifest = z.object({ state: z.literal("STAGING_SCHEMA_VERIFIED"), executable: z.literal(true), scope: z.literal("guarded-staging-schema-only"),
    privateArchive: z.object({ bytes: z.number(), sha256: z.string(), schemaOnly: z.literal(true) }),
    freshInstallProof: z.object({ status: z.literal("PASS_WITH_OWNER_APPROVED_EXCEPTIONS"), unexplainedDifferences: z.literal(0), exceptions: z.array(z.string()),
      evidence: z.literal("docs/evidence/oracle-p3-owner-fidelity.json"), database: z.literal("ir35_baseline_proof_20261021") }),
    publicSqlPublished: z.literal(false), upgradesTested: z.literal(false), productionChanges: z.literal(0) }).parse(read("supabase/baseline/cloud-20261021.json"));
  const exported = z.object({ artifacts: z.record(z.string(), z.object({ bytes: z.number(), sha256: z.string() })) }).parse(read("docs/evidence/oracle-p3-cloud-export.json"));
  expect(manifest.privateArchive).toMatchObject(exported.artifacts[".env.p3-source-schema.dump"]);
  const evidence = z.object({ status: z.literal("PASS"), schemaOnly: z.literal(true), customerRowsImported: z.literal(0), extensionAttempts: z.literal(1),
    gates: z.strictObject({ ir35_owner_parity_20261021: proof, ir35_baseline_proof_20261021: proof }) }).parse(read(manifest.freshInstallProof.evidence));
  expect(manifest.freshInstallProof.exceptions).toEqual(exceptions);
  for (const gate of Object.values(evidence.gates)) expect(gate.exceptions.map(x => x.object)).toEqual(exceptions);
  expect(() => proof.parse({ ...evidence.gates.ir35_owner_parity_20261021, unexplainedDifferences: [{ object: "policy:unexpected" }] })).toThrow();
  expect(readdirSync(new URL("../../supabase/baseline/", import.meta.url)).some(name => name.endsWith(".sql"))).toBe(false);
  const installer = readFileSync(new URL("../../infra/oracle/cloud_baseline.py", import.meta.url), "utf8");
  expect(installer).toContain("validate(manifest,evidence)");
  expect(installer).toContain("--staging-schema-only");
});
