import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("October Next security release gate", () => {
  const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
  it("pins patched framework, React and lint versions, without an advisory waiver", () => {
    for (const [name, version] of Object.entries({ next: "16.4.3", react: "19.2.9", "react-dom": "19.2.9" })) {
      expect(lock.packages[""].dependencies[name]).toBe(version);
      expect(lock.packages[`node_modules/${name}`].version).toBe(version);
    }
    expect(lock.packages[""].devDependencies["eslint-config-next"]).toBe("16.4.3");
    expect(lock.packages["node_modules/eslint-config-next"].version).toBe("16.4.3");
  });
  it("locks the patched Sharp API and both Linux ARM64 runtime dependencies", () => {
    expect(lock.packages["node_modules/sharp"].version).toBe("0.35.5");
    expect(lock.packages["node_modules/@img/sharp-linux-arm64"].version).toBe("0.35.5");
    expect(lock.packages["node_modules/@img/sharp-libvips-linux-arm64"].version).toBe("1.3.4");
    expect(lock.packages["node_modules/next"].optionalDependencies.sharp).toBe("^0.35.5");
  });
  it("has no vulnerable nested Zod copy or forced v3-to-v4 consumer", () => {
    const entries = Object.entries(lock.packages).filter(([name]) => name.endsWith("node_modules/zod"));
    expect(entries.length).toBeGreaterThan(0);
    for (const [, value] of entries) expect((value as { version: string }).version).toBe("4.6.7");
    expect(lock.packages["node_modules/chromium-bidi"].dependencies.zod).toBe("^4.6.5");
    expect(lock.packages["node_modules/lighthouse"].version).toBe("13.5.0");
  });
});
