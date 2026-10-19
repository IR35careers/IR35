import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bounded DB-fixture test resources", () => {
  it("uses one fork without changing test/hook timeouts or excluding fixtures", () => {
    const config = readFileSync(new URL("../../vitest.config.mts", import.meta.url), "utf8");
    expect(config).toContain('pool: "forks"');
    expect(config).toContain("maxWorkers: 1");
    expect(config).toContain("fileParallelism: false");
    expect(config).toContain('include: ["tests/unit/**/*.test.{ts,tsx}"]');
    expect(config).not.toMatch(/\b(?:testTimeout|hookTimeout|exclude|retry)\s*:/);
  });
});
