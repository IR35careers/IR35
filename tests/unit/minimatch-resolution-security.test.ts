import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

describe("consumer-scoped security dependency resolution", () => {
  it("contains no minimatch version in the advisory's corrected affected range", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    const matchers = Object.entries(lock.packages).filter(([path]) => path.endsWith("node_modules/minimatch"));
    expect(matchers.length).toBeGreaterThan(0);
    for (const [path, pkg] of matchers) {
      expect(pkg.version, path).toMatch(/^\d+\.\d+\.\d+$/);
      const [major, minor, patch] = pkg.version!.split(".").map(Number);
      expect(major < 7 || major > 11 || (major === 11 && (minor > 0 || patch >= 1)), path).toBe(true);
    }
  });

  it("preserves unaffected ESLint 3.x callable and helper APIs", () => {
    const fromEslint = createRequire(require.resolve("eslint"));
    const metadata = JSON.parse(readFileSync(fromEslint.resolve("minimatch/package.json"), "utf8")) as { version: string };
    expect(metadata.version).toMatch(/^3\./);
    const matcher = fromEslint("minimatch") as ((value: string, pattern: string) => boolean) & {
      filter(pattern: string): (value: string) => boolean;
      match(values: string[], pattern: string): string[];
      makeRe(pattern: string): RegExp;
      Minimatch: new (pattern: string) => { match(value: string): boolean };
    };
    expect(typeof matcher).toBe("function");
    expect(matcher("src/components/JobCard.tsx", "**/*.{ts,tsx}")).toBe(true);
    expect(matcher("README.md", "**/*.{ts,tsx}")).toBe(false);
    expect(["a.ts", "b.js"].filter(matcher.filter("*.ts"))).toEqual(["a.ts"]);
    expect(matcher.match(["a.ts", "b.js"], "*.ts")).toEqual(["a.ts"]);
    expect(matcher.makeRe("src/**/*.tsx").test("src/components/JobCard.tsx")).toBe(true);
    expect(new matcher.Minimatch("**/!(*.test).ts").match("src/index.ts")).toBe(true);
  });

  it("runs the actual CLI configuration parser against existing root Zod without file or network access", () => {
    const fromQueue = createRequire(require.resolve("@vercel/queue"));
    const fromOidc = createRequire(fromQueue.resolve("@vercel/oidc"));
    const fromConfig = createRequire(fromOidc.resolve("@vercel/cli-config"));
    const metadata = JSON.parse(readFileSync(fromConfig.resolve("zod/package.json"), "utf8")) as { version: string };
    expect(metadata.version).toBe("4.6.7");
    const config = fromOidc("@vercel/cli-config") as {
      parseGlobalConfig(value: unknown): unknown;
      parseAuthConfig(value: unknown): unknown;
    };
    const fs = require("node:fs") as typeof import("node:fs");
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("Compatibility parsers must not read private state");
    });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network is permitted in parser compatibility tests"); }));
    try {
      const fixture = { credStorage: "file", currentTeam: "synthetic-team", telemetry: { enabled: false }, updates: { auto: false } };
      expect(config.parseGlobalConfig(fixture)).toMatchObject(fixture);
      expect(config.parseAuthConfig({ tokenSource: "env", expiresAt: 123 })).toMatchObject({ tokenSource: "env", expiresAt: 123 });
      expect(() => config.parseGlobalConfig({ credStorage: "invalid" })).toThrow();
      expect(() => config.parseAuthConfig({ expiresAt: "not-a-number" })).toThrow();
      expect(readSpy).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
