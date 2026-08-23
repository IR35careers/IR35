import { describe, expect, it } from "vitest";
import { buildApplicationAttention } from "@/lib/application-attention";
import { evaluateProfileReadiness } from "@/lib/workspace/profile-readiness";
import { createSeedWorkspaceState } from "@/lib/workspace/seed";

describe("application attention", () => {
  it("turns unanswered employer fields into a precise action", () => {
    const attention = buildApplicationAttention({
      action: "/profile",
      message: "Two answers are missing.",
      questions: [
        { id: "notice", label: "Notice period", answer: "", required: true, reviewed: false, source: "user" },
        { id: "portfolio", label: "Portfolio", answer: "https://example.com", required: false, reviewed: true, source: "profile" },
      ],
    });
    expect(attention.kind).toBe("answer_questions");
    expect(attention.title).toBe("Answer 1 employer question");
    expect(attention.questionIds).toEqual(["notice"]);
  });

  it("separates CAPTCHA from account and email verification", () => {
    expect(buildApplicationAttention({ action: "captcha" }).kind).toBe("security_check");
    expect(buildApplicationAttention({ action: "employer_login" }).kind).toBe("employer_account");
    expect(buildApplicationAttention({ action: "verification_code" }).kind).toBe("email_verification");
  });

  it("sends employer terms permission to the profile setting", () => {
    const attention = buildApplicationAttention({ action: "employer_terms" });
    expect(attention.kind).toBe("employer_account");
    expect(attention.action).toBe("/profile#portal-automation");
    expect(attention.actionLabel).toBe("Update permission");
  });

  it("routes an unfinished background run to secure browser continuation", () => {
    const attention = buildApplicationAttention({
      action: "browser_continue",
      message: "Continue the approved application on the employer page.",
    });

    expect(attention.kind).toBe("employer_form");
    expect(attention.title).toBe("Continue on the employer page");
    expect(attention.actionLabel).toBe("Continue securely");
  });

  it("opens the prepared employer form when a new required question is found", () => {
    const attention = buildApplicationAttention({
      action: "browser_continue",
      message: "The employer requires one answer that is not saved.",
      questions: [
        {
          id: "employer-reference",
          label: "Employer reference",
          answer: "",
          required: true,
          reviewed: false,
          source: "job",
        },
      ],
    });

    expect(attention.kind).toBe("employer_form");
    expect(attention.title).toBe("Answer 1 employer question");
    expect(attention.actionLabel).toBe("Continue on employer form");
    expect(attention.questionIds).toEqual(["employer-reference"]);
  });
});

describe("profile readiness", () => {
  it("lists incomplete reusable answers before an application starts", () => {
    const profile = createSeedWorkspaceState().profile;
    const result = evaluateProfileReadiness({ ...profile, portalAccountConsent: false, employerTermsConsent: false, automaticEmailVerification: false }, "short");
    expect(result.complete).toBe(false);
    expect(result.missing.map((item) => item.id)).toEqual(expect.arrayContaining(["portal-consent", "cv"]));
  });

  it("requires a role and at least three confirmed skills", () => {
    const profile = createSeedWorkspaceState().profile;
    const result = evaluateProfileReadiness(
      { ...profile, targetRole: "", skills: ["AWS", "Terraform"] },
      "A complete CV with enough truthful content to pass the minimum readiness length for an application profile and employer form.",
    );
    expect(result.missing.map((item) => item.id)).toEqual(expect.arrayContaining(["target-role", "skills"]));
  });
});
