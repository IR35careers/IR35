import { describe, expect, it } from "vitest";
import type { JobDetail } from "@/lib/job-types";
import {
  applicationIsReady,
  canMoveStatus,
  evaluateAutomationJob,
  issueDryRunReceipt,
  prepareApplication,
  reviewApplicationReceipt,
} from "@/lib/workspace/engine";
import { SAMPLE_CONTRACTOR_PROFILE } from "@/lib/workspace/seed";

const job: JobDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Platform Contractor",
  company_name: "Example Client",
  location: "London",
  remote_type: "hybrid",
  ir35_status: "outside",
  ir35_confidence: "medium",
  rate_min: 600,
  rate_max: 650,
  rate_currency: "GBP",
  rate_type: "daily",
  skills: ["AWS", "Kubernetes"],
  posted_at: "2026-08-19T00:00:00.000Z",
  first_seen_at: "2026-08-19T00:00:00.000Z",
  description: "Deliver an AWS platform using Kubernetes and Terraform.",
  apply_url: "https://example.test/jobs/platform",
  source_domain: "example.test",
};

const cv = `Alex Morgan
alex@example.test | London

PROFILE
Platform engineer with cloud delivery experience.

SKILLS
AWS, Git, CI/CD

EXPERIENCE
- Built and supported AWS environments for UK product teams.
- Improved deployment checks and documented recovery procedures.
`;

describe("application workspace engine", () => {
  it("prepares role materials without presenting a missing keyword as experience", () => {
    const application = prepareApplication({ job, profile: SAMPLE_CONTRACTOR_PROFILE, cvText: cv });
    expect(application.matchedKeywords).toContain("AWS");
    expect(application.missingKeywords).toContain("Kubernetes");
    expect(application.coverLetter).toContain("AWS");
    expect(application.coverLetter).not.toContain("experience with AWS and Kubernetes");
    expect(application.status).toBe("needs_review");
  });

  it("uses the CV name when an old generic contractor label is stored", () => {
    const application = prepareApplication({ job, profile: { ...SAMPLE_CONTRACTOR_PROFILE, fullName: "Contractor" }, cvText: cv });
    expect(application.coverLetter).toMatch(/Kind regards,\nAlex Morgan$/);
    expect(application.coverLetter).not.toMatch(/Kind regards,\nContractor$/);
  });

  it("requires every answer and all approvals before issuing a receipt", () => {
    const application = prepareApplication({ job, profile: SAMPLE_CONTRACTOR_PROFILE, cvText: cv });
    expect(applicationIsReady(application)).toBe(false);
    expect(() => issueDryRunReceipt(application)).toThrow(/Review every required answer/);

    const approved = {
      ...application,
      truthApproved: true,
      materialsApproved: true,
      submissionApproved: true,
      questions: application.questions.map((question) => ({ ...question, reviewed: true })),
    };
    expect(applicationIsReady(approved)).toBe(true);
    const receipt = issueDryRunReceipt(approved);
    expect(receipt.mode).toBe("dry_run");
    expect(receipt.message).toMatch(/No application or personal data was sent/);
    expect(receipt.reviewedSnapshot?.resumeVersionLabel).toBe("Application CV");
    expect(receipt.reviewedSnapshot?.answers).toHaveLength(approved.questions.length);
    expect(receipt.review).toBeNull();

    const reviewed = reviewApplicationReceipt(receipt, {
      outcome: "changes_needed",
      flaggedItems: ["cover_letter", "cover_letter"],
      notes: "Use a shorter opening next time.",
    });
    expect(reviewed.review?.flaggedItems).toEqual(["cover_letter"]);
    expect(reviewed.review?.notes).toBe("Use a shorter opening next time.");
    expect(() => reviewApplicationReceipt(receipt, { outcome: "changes_needed", flaggedItems: [], notes: "" })).toThrow(/Flag at least one item/);
  });

  it("keeps controlled automation in a review-first dry run", () => {
    const rules = {
      enabled: true,
      dryRunOnly: true as const,
      minimumMatch: 75,
      minimumDayRate: 500,
      ir35: ["outside"] as const,
      workplaces: ["hybrid"] as const,
      dailyLimit: 5,
      prepareCoverLetter: true,
      requireHumanApproval: true as const,
      excludedCompanies: [],
    };
    expect(evaluateAutomationJob(job, 85, { ...rules, ir35: [...rules.ir35], workplaces: [...rules.workplaces] })).toBeNull();
    expect(evaluateAutomationJob(job, 60, { ...rules, ir35: [...rules.ir35], workplaces: [...rules.workplaces] })).toMatch(/below 75%/);
  });

  it("does not allow a normal pipeline move backwards", () => {
    expect(canMoveStatus("interview", "applied")).toBe(false);
    expect(canMoveStatus("interview", "offer")).toBe(true);
    expect(canMoveStatus("interview", "withdrawn")).toBe(true);
  });
});
