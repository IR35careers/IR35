import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // PGlite/Chromium fixtures must not compete for the small CI host's RAM.
    // Keep every assertion and timeout; serialize files rather than weakening tests.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
