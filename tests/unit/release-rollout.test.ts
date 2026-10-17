import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("Phase 0 migration-first release hold", () => {
  it("prevents a Git merge from deploying the lifecycle before its database is ready", () => {
    const config = z.object({
      git: z.object({ deploymentEnabled: z.record(z.string(), z.boolean()) }),
    }).parse(JSON.parse(readFileSync("vercel.json", "utf8")));
    expect(config.git.deploymentEnabled.main).toBe(false);
    expect(config.git.deploymentEnabled["codex/railway-*"]).toBe(false);
    // A matching true glob would override the hold in Vercel's configuration.
    expect(Object.values(config.git.deploymentEnabled)).not.toContain(true);
  });
});
