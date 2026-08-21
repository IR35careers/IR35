import { describe, expect, it } from "vitest";
import {
  employerOnboardingRateKey,
  validateEmployerOnboardingInput,
} from "@/lib/employer-onboarding";

describe("employer self-service onboarding", () => {
  it("normalises a valid public ATS connection request", () => {
    expect(validateEmployerOnboardingInput({
      companyName: "  Example Recruitment  ",
      contactName: "  Alex Smith  ",
      recruitmentEmail: "  Jobs@ExampleRecruitment.co.uk ",
      type: "Greenhouse",
      slug: "Example-Recruitment",
      consent: true,
      website: "",
    })).toEqual({
      companyName: "Example Recruitment",
      contactName: "Alex Smith",
      recruitmentEmail: "jobs@examplerecruitment.co.uk",
      type: "greenhouse",
      slug: "example-recruitment",
      consent: true,
    });
  });

  it("requires employer authority and rejects invalid or trapped requests", () => {
    expect(() => validateEmployerOnboardingInput({
      companyName: "Example Recruitment",
      contactName: "Alex Smith",
      recruitmentEmail: "jobs@examplerecruitment.co.uk",
      type: "lever",
      slug: "example",
      consent: false,
      website: "",
    })).toThrow(/authorised/i);
    expect(() => validateEmployerOnboardingInput({
      companyName: "Example Recruitment",
      contactName: "Alex Smith",
      recruitmentEmail: "jobs@examplerecruitment.co.uk",
      type: "lever",
      slug: "example",
      consent: true,
      website: "bot-filled.example",
    })).toThrow(/unable to accept/i);
  });

  it("creates stable but purpose-separated rate-limit keys", () => {
    const emailA = employerOnboardingRateKey("email", "Jobs@Company.co.uk");
    const emailB = employerOnboardingRateKey("email", "jobs@company.co.uk");
    const ip = employerOnboardingRateKey("ip", "203.0.113.5");
    expect(emailA).toBe(emailB);
    expect(emailA).toMatch(/^email:[0-9a-f]{64}$/);
    expect(ip).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(ip).not.toBe(emailA);
  });
});
