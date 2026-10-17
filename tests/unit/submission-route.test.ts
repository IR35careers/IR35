import { describe, expect, it } from "vitest";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { detectSubmissionRoute, roleTypeWarning } from "@/lib/ats/submission-route";

describe("application destination detection", () => {
  it("identifies common ATS hosts", () => {
    expect(detectSubmissionRoute({ apply_url: "https://jobs.ashbyhq.com/example/role", source_domain: "ashbyhq.com" }).provider).toBe("ashby");
    expect(detectSubmissionRoute({ apply_url: "https://boards.greenhouse.io/example/jobs/1", source_domain: "greenhouse.io" }).provider).toBe("greenhouse");
    expect(detectSubmissionRoute({ apply_url: "https://jobs.lever.co/example/1", source_domain: "lever.co" }).provider).toBe("lever");
    expect(detectSubmissionRoute({ apply_url: "https://jobs.smartrecruiters.com/example/1", source_domain: "smartrecruiters.com" }).provider).toBe("smartrecruiters");
    expect(detectSubmissionRoute({ apply_url: "https://careers.example.icims.com/jobs/1", source_domain: "icims.com" }).provider).toBe("icims");
    expect(detectSubmissionRoute({ apply_url: "https://example.fa.eu2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1", source_domain: "oraclecloud.com" }).provider).toBe("oracle");
    expect(detectSubmissionRoute({ apply_url: "https://example.teamtailor.com/jobs/1", source_domain: "teamtailor.com" }).provider).toBe("teamtailor");
    expect(detectSubmissionRoute({ apply_url: "https://example.rippling.com/jobs/1", source_domain: "rippling.com" }).provider).toBe("rippling");
  });

  it("does not misclassify lookalike domains", () => {
    expect(detectSubmissionRoute({ apply_url: "https://greenhouse.io.example.test/jobs/1", source_domain: "example.test" }).provider).toBe("other");
  });

  it("warns about salaried and fixed-term listings", () => {
    expect(roleTypeWarning({ ...DEMO_JOBS[0], rate_type: "annual", title: "Platform Manager FTC" })).toMatch(/salaried or fixed-term/i);
    expect(roleTypeWarning(DEMO_JOBS[0])).toBeNull();
  });
});
