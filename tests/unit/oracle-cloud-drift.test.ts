import { describe, expect, it } from "vitest";
import { combineCatalogSecurity, compareCloudClone, originalDrift } from "../../scripts/oracle-cloud-drift";

const object = { kind: "policy", name: "public.jobs.private", hash: "a".repeat(32), value: { using: "(auth.uid() = user_id)", check: "(auth.uid() = user_id)" } };
const catalog = (objects: unknown[]) => ({ version: 1, checkedAt: "2026-10-21T00:00:00Z", serverVersion: "17.6", encoding: "UTF8", collation: { provider: "i", locale: "en-US" }, schemas: ["public"], objects });
describe("exact-cloud migration gates", () => {
  it("rejects duplicate/truncated identifiers rather than overwriting map entries", () => {
    expect(() => compareCloudClone(catalog([object, object]), catalog([]))).toThrow(/Duplicate/);
  });
  it("fails grants and policy differences without any blanket platform exception", () => {
    const result = compareCloudClone(catalog([object]), catalog([{ ...object, hash: "b".repeat(32) }]));
    expect(result).toMatchObject({ status: "FAIL", exceptions: [], phaseComplete: false });
    expect(compareCloudClone(catalog([{ ...object, kind: "grant" }]), catalog([])).status).toBe("FAIL");
  });
  it("never calls catalog equality full data verification", () => {
    expect(compareCloudClone(catalog([object]), catalog([object])).status).toBe("CATALOG_MATCH_ONLY");
  });
  it("halts on a missing role expiry even when all catalog hashes and app-role privileges match", () => {
    const result = compareCloudClone(catalog([object]), catalog([object]));
    const security = { rolesMatch: true, roleExpiry: { status: "PASS", differences: [] },
      privileges: { status: "PASS" }, publicTablesWithoutRLS: [] };
    expect(combineCatalogSecurity(result, security).status).toBe("CATALOG_MATCH_ONLY");
    const mismatch = { role: "cli_login_postgres", cloudHash: "a".repeat(32), cloneHash: "b".repeat(32),
      cloudFiniteExpiry: true, cloneExpiryConfigured: false, morePermissive: true };
    // Inconsistent PASS labels must not conceal the actual difference either.
    const failed = combineCatalogSecurity(result, { ...security, roleExpiry: { status: "PASS", differences: [mismatch] } });
    expect(failed).toMatchObject({ status: "FAIL", securityRepairHold: true, totalUnwaivedDifferences: 1, exceptions: [] });
  });
  it("keeps every original drift entry and flags policy implication for security review", () => {
    const objects = Array.from({ length: 77 }, (_, i) => ({ ...object, name: `public.jobs.policy_${i}` }));
    const original = { differences: objects.map(row => ({ object: `policy:${row.name.slice(7)}`, sourceHash: row.hash, targetHash: null })) };
    const result = originalDrift(original, catalog(objects), catalog([]));
    expect(result).toHaveLength(77);
    expect(result.every(row => row.group === "RLS" && row.securityReview?.includes("cloud-stricter"))).toBe(true);
  });
});
