import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { NextConfig } from "next";

// The builder transpiles the reviewed parent config to a plain local CJS module.
// Native next start/Vercel must not depend on the build command's TS loader.
const base = createRequire(import.meta.url)("./next.base.cjs").default as NextConfig;

// Source is materialised by the guarded builder. Trace only this repository,
// where the single reviewed lockfile installs dependencies, not the workstation.
const config: NextConfig = {
  ...base,
  outputFileTracingRoot: resolve(process.cwd(), ".."),
  turbopack: { ...base.turbopack, root: resolve(process.cwd(), "..") },
};
export default config;
