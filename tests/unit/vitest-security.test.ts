import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createManualModuleSource } from "@vitest/mocker/node";
import { describe, expect, it } from "vitest";

describe("patched Vitest mocker boundary", () => {
  it("locks the patched 4.1.12 toolchain without widening advisory exceptions", () => {
    const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
    expect(lock.packages[""].devDependencies.vitest).toBe("4.1.12");
    expect(lock.packages["node_modules/@vitest/mocker"].version).toBe("4.1.12");
  });
  it("serializes untrusted mock URLs and export names as strings, not executable source", () => {
    const url = 'x"); globalThis.UNEXECUTED_CANARY = 1; void("';
    const name = 'field"]; globalThis.UNEXECUTED_CANARY = 2; //';
    const source = createManualModuleSource(url, [name]);
    expect(source).toContain(`getFactoryModule(${JSON.stringify(url)})`);
    expect(source).toContain(`__factoryModule__[${JSON.stringify(name)}]`);
    expect(source).not.toContain(`getFactoryModule("${url}")`);
  });
  it("uses the upstream Windows-backslash normalization before redirect allowlisting", () => {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve("@vitest/mocker/node"), "utf8");
    expect(source).toContain("join(server.config.root, slash(redirectUrl.pathname))");
    expect(source).toContain("if (!isFileLoadingAllowed(server.config, redirect))");
  });
});
