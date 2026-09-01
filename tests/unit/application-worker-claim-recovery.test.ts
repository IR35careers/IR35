import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("application worker idle recovery", () => {
  it("checks paused employer-email applications before an idle claim returns", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/app/api/applications/worker/claim/route.ts",
      ),
      "utf8",
    );
    const emptyClaimRecovery = source.search(
      /if \(!task\) \{\s+await recoverPendingVerificationEmails/,
    );
    const emptyClaimReturn = source.search(
      /if \(!task\)\s+return Response\.json\(\{ assignment: null \}/,
    );

    expect(emptyClaimRecovery).toBeGreaterThan(-1);
    expect(emptyClaimReturn).toBeGreaterThan(emptyClaimRecovery);
    expect(source.slice(emptyClaimRecovery, emptyClaimReturn)).toContain(
      'admin.rpc("claim_application_worker_task"',
    );
  });
});
