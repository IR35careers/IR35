import { describe, expect, it } from "vitest";
import { shouldRecoverDiscoverySource } from "@/lib/application-worker-source-recovery";

describe("application worker direct-source recovery", () => {
  it("retries an employer-login stop when the saved destination is a discovery board", () => {
    expect(
      shouldRecoverDiscoverySource({
        action: "employer_login",
        taskStatus: "needs_user",
        destination: "https://www.adzuna.co.uk/jobs/details/5854167856",
      }),
    ).toBe(true);
    expect(
      shouldRecoverDiscoverySource({
        action: "employer_login",
        taskStatus: "needs_user",
        destination: "https://www.totaljobs.com/job/123",
      }),
    ).toBe(true);
  });

  it("does not loop on a recruiter-owned destination or a security step", () => {
    expect(
      shouldRecoverDiscoverySource({
        action: "employer_login",
        taskStatus: "needs_user",
        destination:
          "https://viqu.co.uk/job/devops-engineer-sc-cleared-hybrid-inside-ir35/apply",
      }),
    ).toBe(false);
    expect(
      shouldRecoverDiscoverySource({
        action: "captcha",
        taskStatus: "needs_user",
        destination: "https://www.adzuna.co.uk/jobs/details/5854167856",
      }),
    ).toBe(false);
  });
});
