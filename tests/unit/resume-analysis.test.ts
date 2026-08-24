import { describe, expect, it } from "vitest";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import {
  analyseResumeForRole,
  applyResumeSuggestions,
  parseResumeText,
  resumeContainsTerm,
  scoreResumeForRole,
} from "@/lib/resume/analysis";

const job = DEMO_JOBS[0];
const source = `Alex Morgan
alex@example.com | +44 7700 900123

PROFILE
Cloud contractor supporting reliable delivery platforms.

SKILLS
AWS | Terraform | Docker

EXPERIENCE
- I was responsible for AWS platform improvements
- I worked on reusable Terraform modules
- Reduced deployment failures by 28%

EDUCATION
BSc Computing`;

describe("role-specific Resume analysis", () => {
  it("parses common sections and contact evidence", () => {
    const parsed = parseResumeText(source, "alex.docx");
    expect(parsed.candidateName).toBe("Alex Morgan");
    expect(parsed.contactLine).toContain("alex@example.com");
    expect(parsed.sections.some((section) => section.kind === "experience")).toBe(true);
  });

  it("finds the candidate when a generated profile section appears before the identity", () => {
    const parsed = parseResumeText(`PROFILE
Experience includes AWS and Terraform, supported by delivery examples.
Alex Morgan
Senior Platform Engineer
alex@example.com | +44 7700 900123

CORE SKILLS
AWS | Terraform`, "alex.pdf");
    expect(parsed.candidateName).toBe("Alex Morgan");
    expect(parsed.contactLine).toContain("alex@example.com");
  });

  it("does not mistake an uppercase candidate name for a section heading", () => {
    const parsed = parseResumeText(`ANVESH MANNURU
SITE RELIABILITY ENGINEER (SRE)
mail2mannuru@gmail.com | +44 7438 977103

PROFESSIONAL SUMMARY
Site reliability engineer with five years of experience.`, "anvesh.pdf");
    expect(parsed.candidateName).toBe("ANVESH MANNURU");
    expect(parsed.sections.some((section) => section.content.includes("ANVESH MANNURU"))).toBe(true);
  });

  it("removes empty bullet rows before building Resume sections", () => {
    const parsed = parseResumeText(`Alex Morgan
alex@example.com

EXPERIENCE
Built reliable delivery pipelines.
•
•
•
Reduced deployment failures by 28%.`, "alex.pdf");

    expect(parsed.rawText).not.toMatch(/^\s*•\s*$/m);
    expect(parsed.rawText).toContain("Built reliable delivery pipelines.");
    expect(parsed.rawText).toContain("Reduced deployment failures by 28%.");
  });

  it("reports matched and missing role keywords using a transparent score", () => {
    const score = scoreResumeForRole(source, job, "alex.docx");
    expect(score.matchedKeywords).toEqual(expect.arrayContaining(["AWS", "Terraform"]));
    expect(score.missingKeywords).toEqual(expect.arrayContaining(["Kubernetes", "DevOps"]));
    expect(score.overall).toBeGreaterThan(0);
    expect(score.overall).toBeLessThanOrEqual(100);
    expect(score.breakdown.keywordCoverage).toBeLessThan(100);
  });

  it("never inserts missing keywords through default safe suggestions", () => {
    const analysis = analyseResumeForRole(source, "alex.docx", job);
    expect(analysis.suggestions.filter((suggestion) => suggestion.kind === "rewrite")).toHaveLength(2);
    const tailored = applyResumeSuggestions(source, analysis.suggestions, analysis.defaultAcceptedIds, []);
    expect(resumeContainsTerm(tailored, "AWS")).toBe(true);
    expect(resumeContainsTerm(tailored, "Terraform")).toBe(true);
    expect(resumeContainsTerm(tailored, "Kubernetes")).toBe(false);
    expect(resumeContainsTerm(tailored, "DevOps")).toBe(false);
    expect(tailored).toContain("Responsible for AWS platform improvements.");
  });

  it("adds a missing skill only after the same suggestion is accepted and confirmed", () => {
    const analysis = analyseResumeForRole(source, "alex.docx", job);
    const kubernetes = analysis.suggestions.find((suggestion) => suggestion.replacement === "Kubernetes");
    expect(kubernetes).toBeDefined();
    const acceptedOnly = applyResumeSuggestions(source, analysis.suggestions, [kubernetes!.id], []);
    const confirmed = applyResumeSuggestions(source, analysis.suggestions, [kubernetes!.id], [kubernetes!.id]);
    expect(resumeContainsTerm(acceptedOnly, "Kubernetes")).toBe(false);
    expect(resumeContainsTerm(confirmed, "Kubernetes")).toBe(true);
    expect(confirmed).toContain("VERIFIED ROLE SKILLS");
  });
});
