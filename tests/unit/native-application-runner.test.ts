import { describe, expect, it } from "vitest";
import {
  detectAts,
  isEmployerAccountAccessPage,
  isApplicationFormEvidence,
  isJobBoardUtilityControl,
  requiresEmployerTermsAcceptance,
  isEmployerTermsCheckbox,
  isSafeApplicationHandoffNavigation,
  isSourceAccessDeniedPage,
  isTrustedApplicationPortalSender,
  nativeRunnerHostAllowed,
} from "@/lib/application-runner/ats";
import { closestOption, deterministicMapping, screeningAnswer } from "@/lib/application-runner/field-mapping";
import { buildRunnerFacts, type RunnerField } from "@/lib/application-runner/types";
import { SAMPLE_CONTRACTOR_PROFILE } from "@/lib/workspace/seed";

function field(overrides: Partial<RunnerField>): RunnerField {
  return {
    id: "field_1",
    index: 0,
    type: "text",
    label: "",
    name: "",
    placeholder: "",
    required: true,
    options: [],
    optionValue: "",
    optionLabel: "",
    ...overrides,
  };
}

describe("native application runner", () => {
  it("recognises email-first employer account screens before a password appears", () => {
    expect(
      isEmployerAccountAccessPage({
        body: "Sign in to continue. Enter your email address and select Next.",
        hasEmailInput: true,
        hasPasswordInput: false,
        hasApplicationForm: false,
      }),
    ).toBe(true);
    expect(
      isEmployerAccountAccessPage({
        body: "Apply for this role",
        hasEmailInput: true,
        hasPasswordInput: false,
        hasApplicationForm: true,
      }),
    ).toBe(false);
  });
  it("detects common ATS destinations without relying on a third-party submission API", () => {
    expect(detectAts("https://boards.greenhouse.io/company/jobs/1").kind).toBe("greenhouse");
    expect(detectAts("https://jobs.lever.co/company/role").kind).toBe("lever");
    expect(detectAts("https://jobs.ashbyhq.com/company/role").kind).toBe("ashby");
    expect(detectAts("https://careers.example.com/role").kind).toBe("generic");
    expect(nativeRunnerHostAllowed("jobs.ashbyhq.com")).toBe(true);
    expect(nativeRunnerHostAllowed("www.adzuna.co.uk")).toBe(true);
    expect(nativeRunnerHostAllowed("www.reed.co.uk")).toBe(true);
    expect(nativeRunnerHostAllowed("evilashbyhq.com")).toBe(false);
    expect(nativeRunnerHostAllowed("fake-adzuna.co.uk.attacker.example")).toBe(false);
    expect(nativeRunnerHostAllowed("greenhouse.io.attacker.example")).toBe(false);
  });

  it("maps normal identity and work-authorisation fields deterministically", () => {
    expect(deterministicMapping(field({ label: "First name" }))).toMatchObject({ factKey: "first_name" });
    expect(deterministicMapping(field({ label: "Will you now or in future require visa sponsorship?" }))).toMatchObject({ factKey: "needs_sponsorship" });
    expect(deterministicMapping(field({ label: "Expected annual salary" }))).toMatchObject({ factKey: "target_annual_salary" });
    expect(deterministicMapping(field({ label: "Date of birth" }))).toMatchObject({ factKey: "needs_user" });
    expect(deterministicMapping(field({ label: "Current salary" }))).toMatchObject({ factKey: "needs_user" });
  });

  it("admits a safe employer handoff only before candidate data is entered", () => {
    const handoff = {
      url: "https://careers.employer.example/jobs/123/apply",
      method: "GET",
      resourceType: "document",
      isNavigationRequest: true,
      isTopLevel: true,
      sensitive: false,
    };
    expect(isSafeApplicationHandoffNavigation(handoff)).toBe(true);
    expect(
      isSafeApplicationHandoffNavigation({ ...handoff, sensitive: true }),
    ).toBe(false);
    expect(
      isSafeApplicationHandoffNavigation({
        ...handoff,
        url: "http://127.0.0.1/internal",
      }),
    ).toBe(false);
    expect(
      isSafeApplicationHandoffNavigation({
        ...handoff,
        resourceType: "iframe",
        isTopLevel: false,
      }),
    ).toBe(false);
  });

  it("does not mistake job search and alert controls for an application form", () => {
    expect(isJobBoardUtilityControl("email_alert your.email@domain.com")).toBe(true);
    expect(isJobBoardUtilityControl("q job, company, title")).toBe(true);
    expect(isJobBoardUtilityControl("w city, county or postcode")).toBe(true);
    expect(
      isApplicationFormEvidence({
        hasResumeUpload: false,
        hasNameField: false,
        hasContactField: true,
        applicationSignals: 2,
      }),
    ).toBe(false);
    expect(
      isApplicationFormEvidence({
        hasResumeUpload: false,
        hasNameField: true,
        hasContactField: true,
        applicationSignals: 2,
      }),
    ).toBe(true);
  });

  it("recognises a blocked job-board handoff as a source problem", () => {
    expect(isSourceAccessDeniedPage("Access Denied", "Reference 123")).toBe(true);
    expect(isSourceAccessDeniedPage("Apply", "Complete your application")).toBe(false);
  });

  it("requires the contractor to accept third-party account terms", () => {
    expect(
      requiresEmployerTermsAcceptance(
        "By registering with Example Jobs you agree to our Terms and Conditions and Privacy Notice.",
      ),
    ).toBe(true);
    expect(
      requiresEmployerTermsAcceptance(
        "Create your application account to save progress and continue.",
      ),
    ).toBe(false);
  });

  it("accepts only employer account terms and never marketing choices", () => {
    expect(isEmployerTermsCheckbox("I agree to the Terms and Conditions and Privacy Notice")).toBe(true);
    expect(isEmployerTermsCheckbox("I confirm the candidate declaration")).toBe(true);
    expect(isEmployerTermsCheckbox("Send me marketing offers and job alerts")).toBe(false);
    expect(isEmployerTermsCheckbox("Join the talent community newsletter")).toBe(false);
  });

  it("trusts confirmation mail only from the ATS family used by the application", () => {
    expect(
      isTrustedApplicationPortalSender(
        "Applications <updates@notifications.ashbyhq.com>",
        "https://jobs.ashbyhq.com/example/role",
      ),
    ).toBe(true);
    expect(
      isTrustedApplicationPortalSender(
        "Fake recruiter <updates@attacker.example>",
        "https://jobs.ashbyhq.com/example/role",
      ),
    ).toBe(false);
    expect(
      isTrustedApplicationPortalSender(
        "Recruiter <updates@employer.example>",
        "https://careers.employer.example/role",
      ),
    ).toBe(true);
    expect(
      isTrustedApplicationPortalSender(
        "Fake recruiter <updates@unrelated.example>",
        "https://careers.employer.example/role",
      ),
    ).toBe(false);
  });

  it("uses only confirmed saved answers for employer-specific questions", () => {
    const facts = buildRunnerFacts(SAMPLE_CONTRACTOR_PROFILE, [{ id: "q1", label: "What is your notice period?", answer: "Two weeks", required: true, source: "user", reviewed: true }]);
    expect(screeningAnswer(field({ label: "What is your notice period?" }), facts)).toBe("Two weeks");
    expect(facts.values.email).toBe(SAMPLE_CONTRACTOR_PROFILE.email);
  });

  it("matches yes and no choices without guessing unrelated options", () => {
    expect(closestOption("Yes", ["Please select", "Yes", "No"])).toBe("Yes");
    expect(closestOption("No", ["I require sponsorship", "I do not require sponsorship"])).toBe("");
  });
});
