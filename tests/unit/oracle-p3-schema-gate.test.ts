import { describe, expect, it } from "vitest";
import { compareP3Schema } from "../../scripts/oracle-p3-schema-gate";

const catalog = (objects: unknown[]) => ({ scope: "public subset", checkedAt: "2026-10-21T00:00:00Z", serverVersion: "17.6", objects });
const object = { kind: "column", name: "application_packets.delivery_status", hash: "a".repeat(32) };
describe("P3 schema gate", () => {
  it("fails on a planned migration difference without silently exempting025", () => {
    expect(compareP3Schema(catalog([]), catalog([object])).status).toBe("FAIL");
  });
  it("fails on character-level definition hash differences", () => {
    expect(compareP3Schema(catalog([object]), catalog([{ ...object, hash: "b".repeat(32) }])).differences).toHaveLength(1);
  });
  it("never calls subset equality a full migration PASS", () => {
    expect(compareP3Schema(catalog([object]), catalog([object]))).toMatchObject({ status: "SUBSET_MATCH_ONLY", fullVerification: false });
  });
  it("rejects duplicate objects and malformed/untrusted metadata", () => {
    expect(() => compareP3Schema(catalog([object, object]), catalog([]))).toThrow();
    expect(() => compareP3Schema(catalog([{ ...object, hash: "not-a-hash" }]), catalog([]))).toThrow();
  });
});
