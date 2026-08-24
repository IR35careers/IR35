import { describe, expect, it } from "vitest";
import {
  AUTO_APPLY_CONSENT_VERSION,
  autoApplyNeedsReview,
  autoApplyReviewReason,
  hasCurrentAutoApplyConsent,
  laneMatchesJob,
  unresolvedRequiredQuestions,
} from "@/lib/automation/auto-apply";

describe("auto apply", () => {
  it("requires explicit current-version consent", () => {
    expect(hasCurrentAutoApplyConsent({ enabled: true, consentAt: "2026-08-21T12:00:00.000Z", consentVersion: AUTO_APPLY_CONSENT_VERSION })).toBe(true);
    expect(hasCurrentAutoApplyConsent({ enabled: true, consentAt: "2026-08-21T12:00:00.000Z", consentVersion: "old" })).toBe(false);
    expect(hasCurrentAutoApplyConsent({ enabled: false, consentAt: "2026-08-21T12:00:00.000Z", consentVersion: AUTO_APPLY_CONSENT_VERSION })).toBe(false);
  });

  it("matches enabled role lanes", () => {
    const job = { title: "Senior DevOps Engineer", description: "AWS and Terraform delivery", location: "London" };
    expect(laneMatchesJob([{ id: "1", role: "DevOps", keywords: ["Terraform"], location: "UK", enabled: true }], job)).toBe(true);
    expect(laneMatchesJob([{ id: "2", role: "Data Scientist", keywords: ["Python"], location: "UK", enabled: true }], job)).toBe(false);
  });

  it("returns only unanswered required questions", () => {
    const questions = [
      { id: "1", label: "Right to work", answer: "Yes", required: true, reviewed: true, source: "profile" as const },
      { id: "2", label: "Clearance", answer: "", required: true, reviewed: false, source: "user" as const },
      { id: "3", label: "Optional", answer: "", required: false, reviewed: false, source: "user" as const },
    ];
    expect(unresolvedRequiredQuestions(questions).map((item) => item.id)).toEqual(["2"]);
  });

  it("keeps Resume review and final submission review as separate controls", () => {
    expect(
      autoApplyNeedsReview({
        resumeOptimisation: "honest",
        autoApproveSafeEdits: false,
        reviewBeforeSubmit: false,
      }),
    ).toBe(true);
    expect(
      autoApplyNeedsReview({
        resumeOptimisation: "honest",
        autoApproveSafeEdits: true,
        reviewBeforeSubmit: true,
      }),
    ).toBe(true);
    expect(
      autoApplyNeedsReview({
        resumeOptimisation: "honest",
        autoApproveSafeEdits: true,
        reviewBeforeSubmit: false,
      }),
    ).toBe(false);
    expect(
      autoApplyReviewReason({
        resumeOptimisation: "strong",
        autoApproveSafeEdits: false,
        reviewBeforeSubmit: false,
      }),
    ).toContain("Resume changes");
  });
});
