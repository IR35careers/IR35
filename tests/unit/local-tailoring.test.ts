import { describe, expect, it } from "vitest";
import { buildLocalTailoringResult } from "@/lib/ai/local-tailoring";
import { DEMO_JOBS } from "@/lib/demo-jobs";

describe("local role tailoring", () => {
  it("returns reviewable suggestions without inventing missing experience", () => {
    const cv = `Alex Morgan
alex@example.test

PROFILE
Platform engineer with AWS delivery experience.

EXPERIENCE
- I was responsible for AWS platform support and recovery testing.
`;
    const result = buildLocalTailoringResult(cv, DEMO_JOBS[0]);
    expect(result.model).toBe("ir35careers-evidence-engine");
    expect(result.baseline.missingKeywords.length).toBeGreaterThan(0);
    expect(result.suggestions.every((suggestion) => cv.includes(suggestion.original))).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.replacement.includes("Not found"))).toBe(false);
  });

  it("moves evidenced role skills forward without adding missing skills", () => {
    const cv = `Alex Morgan

PROFILE
Platform engineer.

SKILLS
Git, Communication, Terraform, AWS, Linux

EXPERIENCE
Built AWS infrastructure with Terraform for UK product teams.`;
    const result = buildLocalTailoringResult(cv, DEMO_JOBS[0]);
    const skills = result.suggestions.find((suggestion) => suggestion.section === "Skills");
    expect(skills?.replacement).toContain("- AWS");
    expect(skills?.replacement).toContain("- Terraform");
    expect(skills?.replacement).not.toContain("Kubernetes");
    expect(skills?.evidenceQuote).toBe("Git, Communication, Terraform, AWS, Linux");
  });
});
