import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateDependencyAudit } from "../../scripts/security-audit";

const advisory = { name: "braces", title: "Nested pattern stack exhaustion", url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm" };
const audit = { auditReportVersion: 2, vulnerabilities: {
  braces: { name: "braces", nodes: ["node_modules/braces"], via: [advisory] },
  wrapper: { name: "wrapper", nodes: ["node_modules/wrapper"], via: ["braces"] },
} };
const lock = { packages: { "node_modules/braces": { version: "3.0.3" } } };
const exception = { advisory: "GHSA-vfj7-8cjw-p6xm", package: "braces", versions: ["3.0.3"],
  expiresAt: "2026-10-29T00:00:00Z", reason: "Owner-approved scoped exception for repository-only build globs." };
const now = new Date("2026-10-17T12:00:00Z");

describe("bounded dependency security exceptions", () => {
  it("accepts only the approved leaf and its transitive wrappers", () => {
    const result = evaluateDependencyAudit(audit, lock, [exception], now);
    expect(result.problems).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });
  it("blocks every finding without explicit approval", () => {
    expect(evaluateDependencyAudit(audit, lock, [], now).problems.length).toBeGreaterThan(0);
  });
  it("blocks new advisories on an excepted package", () => {
    const changed = structuredClone(audit);
    changed.vulnerabilities.braces.via.push({ ...advisory, url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" });
    expect(evaluateDependencyAudit(changed, lock, [exception], now).problems).toContain("braces: GHSA-aaaa-bbbb-cccc (3.0.3)");
  });
  it("does not extend approval to a different installed version or missing lock row", () => {
    expect(evaluateDependencyAudit(audit, { packages: { "node_modules/braces": { version: "3.0.2" } } }, [exception], now).problems.length).toBeGreaterThan(0);
    expect(evaluateDependencyAudit(audit, { packages: {} }, [exception], now).problems.length).toBeGreaterThan(0);
  });
  it("fails at expiry, including when the dependency has since been removed", () => {
    const expired = new Date(exception.expiresAt);
    expect(evaluateDependencyAudit(audit, lock, [exception], expired).problems).toContain(`Expired exception: ${exception.advisory}`);
    expect(evaluateDependencyAudit({ ...audit, vulnerabilities: {} }, lock, [exception], expired).problems.length).toBeGreaterThan(0);
  });
  it("fails malformed reports, incomplete graphs and lookalike advisory URLs", () => {
    expect(() => evaluateDependencyAudit({}, lock, [exception], now)).toThrow();
    expect(evaluateDependencyAudit({ ...audit, vulnerabilities: { wrapper: audit.vulnerabilities.wrapper } }, lock, [exception], now).problems.length).toBeGreaterThan(0);
    const changed = structuredClone(audit);
    changed.vulnerabilities.braces.via[0].url = "https://github.com.evil.test/advisories/GHSA-vfj7-8cjw-p6xm";
    expect(evaluateDependencyAudit(changed, lock, [exception], now).problems.length).toBeGreaterThan(0);
  });
  it("keeps the owner-approved list limited to the two exact advisories and versions", () => {
    const approved = JSON.parse(readFileSync("security/audit-exceptions.json", "utf8"));
    expect(approved.map((row: { advisory: string; versions: string[] }) => [row.advisory, row.versions])).toEqual([
      ["GHSA-vfj7-8cjw-p6xm", ["3.0.3"]], ["GHSA-hp3w-g68c-fv3c", ["1.0.3"]],
    ]);
  });
});

describe("exception reachability constraints", () => {
  it("keeps braces development-only and the selector-parser patched", () => {
    const installed = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(installed.packages["node_modules/braces"].dev).toBe(true);
    const parsers = Object.entries(installed.packages).filter(([path]) => path.endsWith("node_modules/postcss-selector-parser"));
    expect(parsers.length).toBeGreaterThan(0);
    for (const [, pkg] of parsers) expect((pkg as { version: string }).version).toBe("7.1.6");
  });
  it("does not load argparse or sprintf-js through the actual Mammoth library entry", () => {
    const require = createRequire(import.meta.url);
    const mammoth = require("mammoth");
    expect(typeof mammoth.extractRawText).toBe("function");
    const visited = new Set<string>();
    const traverse = (module: NodeJS.Module | undefined) => {
      if (!module || visited.has(module.id)) return;
      visited.add(module.id);
      for (const child of module.children) traverse(child);
    };
    traverse(require.cache[require.resolve("mammoth")]);
    expect(visited.size).toBeGreaterThan(10);
    expect([...visited].filter((path) => /node_modules[\\/](argparse|sprintf-js)[\\/]/.test(path))).toEqual([]);
  }, 30_000); // Cold CommonJS graph loading on the 8 GB Windows workstation.
});
