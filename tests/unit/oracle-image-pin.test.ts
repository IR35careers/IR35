import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const pin = z.strictObject({ repository: z.literal("supabase/postgres"), tag: z.string().regex(/^17\.\d+\./),
  platform: z.literal("linux/arm64"), indexDigest: digest, platformDigest: digest,
  pinnedImage: z.string(), verification: z.string(), extensionCompatibility: z.string(), requiredExtensions: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(new URL("../../infra/oracle/postgres-image.json", import.meta.url), "utf8")));

describe("owner-approved PostgreSQL restore target", () => {
  it("pins a native ARM PostgreSQL 17.6+ child digest, never a mutable tag or PG15", () => {
    expect(Number(pin.tag.split(".")[1])).toBeGreaterThanOrEqual(6);
    expect(pin.pinnedImage).toBe(`${pin.repository}:${pin.tag}@${pin.platformDigest}`);
    expect(pin.extensionCompatibility).toContain("UNVERIFIED");
  });
  it("requires the exact observed cloud extension versions", () => {
    const inventory = JSON.parse(readFileSync(new URL("../../docs/oracle-migration-inventory.json", import.meta.url), "utf8"));
    const extensions = z.array(z.object({ name: z.string(), version: z.string() })).parse(inventory.extensions);
    expect(pin.requiredExtensions).toEqual(Object.fromEntries(extensions.map(row => [row.name, row.version])));
  });
  it("records native exact-version execution without confusing it with full P3 completion", () => {
    const evidence = z.object({ phase: z.literal("P3"), phaseComplete: z.literal(false), image: z.string(),
      nativeImage: z.object({ status: z.literal("PASS"), platform: z.literal("linux/arm64"), imageId: digest }),
      extensionProbe: z.object({ status: z.literal("PASS"), serverVersionNum: z.number().int().min(170006).max(179999),
        network: z.literal("none"), publicPorts: z.array(z.never()).length(0), customerRows: z.literal(0),
        extensions: z.array(z.object({ name: z.string(), version: z.string(), available: z.literal(true),
          loaded: z.literal(true), exercised: z.literal(true), sqlstate: z.null() })) }) })
      .parse(JSON.parse(readFileSync(new URL("../../docs/evidence/oracle-p3-native.json", import.meta.url), "utf8")));
    expect(evidence.image).toBe(pin.pinnedImage);
    expect(evidence.nativeImage.imageId).toBe(pin.platformDigest);
    expect(evidence.extensionProbe.extensions).toHaveLength(Object.keys(pin.requiredExtensions).length);
    expect(Object.fromEntries(evidence.extensionProbe.extensions.map(row => [row.name, row.version]))).toEqual(pin.requiredExtensions);
  });
  it("provides a read-only compatibility query instead of silently upgrading extensions", () => {
    const sql = readFileSync(new URL("../../supabase/verification/oracle_extension_compatibility.sql", import.meta.url), "utf8");
    expect(sql).toContain("BEGIN TRANSACTION READ ONLY;");
    expect(sql).toContain("pg_available_extension_versions");
    expect(sql).toContain("installed_version_matches");
    expect(sql).toContain("ROLLBACK;");
    for (const [name, version] of Object.entries(pin.requiredExtensions)) expect(sql).toContain(`('${name}', '${version}')`);
    expect(sql.replace(/^--.*$/gm, "")).not.toMatch(/\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });
});
