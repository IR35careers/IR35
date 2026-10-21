import { readFileSync, readdirSync } from "node:fs";
import { z } from "zod";
import { describe, expect, it } from "vitest";

const baseline = z.strictObject({ version: z.literal(1), state: z.literal("BLOCKED"), executable: z.literal(false), generatedFrom: z.string(),
  sourceServerVersion: z.literal("17.6"), clientVersion: z.literal("17.11"),
  privateArchive: z.strictObject({ path: z.literal("/opt/ir35/.env.p3-source-schema.dump"), bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), schemaOnly: z.literal(true), mode: z.literal("600"), owner: z.literal("ir35") }),
  schemas: z.array(z.string()), freshInstallProof: z.strictObject({ status: z.literal("FAIL"), sourceObjects: z.number().int(), targetObjects: z.number().int(), differences: z.number().int().positive(), exceptions: z.literal(0), evidence: z.literal("docs/evidence/oracle-p3-clone-gate.json") }),
  publicSqlPublished: z.literal(false), upgradesTested: z.literal(false), productionChanges: z.literal(0) });
const read = (name: string) => JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), "utf8"));
describe("blocked cloud baseline candidate", () => {
  it("binds the actual private generated artifact and failed fresh-install evidence, never a fake PASS", () => {
    const manifest = baseline.parse(read("supabase/baseline/cloud-20261021.json"));
    const exported = z.object({ schemaOnly: z.literal(true), artifacts: z.record(z.string(), z.object({ bytes: z.number(), sha256: z.string() })) }).parse(read("docs/evidence/oracle-p3-cloud-export.json"));
    const gate = z.object({ status: z.literal("FAIL"), sourceObjects: z.number(), targetObjects: z.number(), differences: z.array(z.unknown()) }).parse(read("docs/evidence/oracle-p3-clone-gate.json"));
    expect(manifest.privateArchive.sha256).toBe(exported.artifacts[".env.p3-source-schema.dump"].sha256);
    expect(manifest.privateArchive.bytes).toBe(exported.artifacts[".env.p3-source-schema.dump"].bytes);
    expect(manifest.freshInstallProof).toMatchObject({ status: gate.status, sourceObjects: gate.sourceObjects, targetObjects: gate.targetObjects, differences: gate.differences.length });
    expect(() => baseline.parse({ ...manifest, executable: true })).toThrow();
    expect(readdirSync(new URL("../../supabase/baseline/", import.meta.url)).some(name => name.endsWith(".sql"))).toBe(false);
  });
});
