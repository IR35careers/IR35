import { describe, expect, it } from "vitest";
import {
  canAutomaticallyAcceptEmployerTerms,
  detectAts,
  isEmployerAuthenticationFailure,
  isEmployerAccountRecoveryControl,
  isEmployerAccountAccessPage,
  isEmployerEmailLinkPending,
  isEmployerGuestApplicationControl,
  isEmployerPasswordlessAccessControl,
  isEmployerPasswordSetupPage,
  isApplicationFormEvidence,
  isJobBoardUtilityControl,
  matchesApplicationAction,
  requiresEmployerTermsAcceptance,
  isEmployerTermsCheckbox,
  isClosedListingPage,
  isVerificationResendControl,
  isSafeApplicationHandoffNavigation,
  isSourceAccessDeniedPage,
  isTrustedApplicationPortalSender,
  nativeRunnerHostAllowed,
  preferEmployerSignIn,
  preferredResumeUploadFormat,
  shouldTreatSingleFileAsResume,
  shouldSkipConsumedResumeInput,
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
    expect(
      isEmployerAccountAccessPage({
        body: "Email address. Continue with email. You are applying for DevOps Engineer.",
        hasEmailInput: true,
        hasPasswordInput: false,
        hasApplicationForm: true,
      }),
    ).toBe(true);
  });
  it("detects common ATS destinations without relying on a third-party submission API", () => {
    expect(detectAts("https://boards.greenhouse.io/company/jobs/1").kind).toBe("greenhouse");
    expect(detectAts("https://jobs.lever.co/company/role").kind).toBe("lever");
    expect(detectAts("https://jobs.ashbyhq.com/company/role").kind).toBe("ashby");
    const totaljobs = detectAts(
      "https://www.totaljobs.com/job/123/application/authentication",
    );
    expect(totaljobs.kind).toBe("totaljobs");
    expect(totaljobs.nextPattern.test("Continue with email")).toBe(true);
    expect(totaljobs.nextPattern.test("Continue application")).toBe(true);
    expect(detectAts("https://jobs.example.icims.com/jobs/123").kind).toBe("icims");
    expect(detectAts("https://example.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/job/123").kind).toBe("oracle");
    expect(detectAts("https://workforcenow.adp.com/mascsr/default/mdf/recruitment/job/123").kind).toBe("adp");
    expect(detectAts("https://example.bamboohr.com/careers/123").kind).toBe("bamboohr");
    expect(detectAts("https://jobs.teamtailor.com/example/123").kind).toBe("teamtailor");
    expect(detectAts("https://careers.example.com/role").kind).toBe("generic");
    expect(nativeRunnerHostAllowed("jobs.ashbyhq.com")).toBe(true);
    expect(nativeRunnerHostAllowed("www.adzuna.co.uk")).toBe(true);
    expect(nativeRunnerHostAllowed("www.reed.co.uk")).toBe(true);
    expect(nativeRunnerHostAllowed("www.cv-library.co.uk")).toBe(true);
    expect(nativeRunnerHostAllowed("www.totaljobs.com")).toBe(true);
    expect(
      nativeRunnerHostAllowed(
        "tjgliveassets.s3.eu-west-1.amazonaws.com",
      ),
    ).toBe(true);
    expect(
      nativeRunnerHostAllowed(
        "tjgliveassets.s3.eu-west-1.amazonaws.com.attacker.example",
      ),
    ).toBe(false);
    expect(nativeRunnerHostAllowed("evilashbyhq.com")).toBe(false);
    expect(nativeRunnerHostAllowed("fake-adzuna.co.uk.attacker.example")).toBe(false);
    expect(nativeRunnerHostAllowed("greenhouse.io.attacker.example")).toBe(false);
  });

  it("recognises Totaljobs' single Experience upload as the application Resume", () => {
    expect(
      shouldTreatSingleFileAsResume({
        atsKind: "totaljobs",
        fileUploadCount: 1,
        pageCopy: "Let's complete your application Contact details Experience",
      }),
    ).toBe(true);
    expect(
      shouldTreatSingleFileAsResume({
        atsKind: "generic",
        fileUploadCount: 1,
        pageCopy: "Upload your Resume",
      }),
    ).toBe(true);
    expect(
      shouldTreatSingleFileAsResume({
        atsKind: "generic",
        fileUploadCount: 2,
        pageCopy: "Upload your Resume and portfolio",
      }),
    ).toBe(false);
  });

  it("does not upload a custom portal Resume twice after its hidden input is consumed", () => {
    expect(
      shouldSkipConsumedResumeInput({
        fieldType: "file",
        resumeAlreadyUploaded: true,
      }),
    ).toBe(true);
    expect(
      shouldSkipConsumedResumeInput({
        fieldType: "file",
        resumeAlreadyUploaded: false,
      }),
    ).toBe(false);
    expect(
      shouldSkipConsumedResumeInput({
        fieldType: "text",
        resumeAlreadyUploaded: true,
      }),
    ).toBe(false);
  });

  it("uses the document format accepted by each employer scorer", () => {
    expect(preferredResumeUploadFormat("totaljobs")).toBe("docx");
    expect(preferredResumeUploadFormat("greenhouse")).toBe("pdf");
    expect(preferredResumeUploadFormat("generic")).toBe("pdf");
  });

  it("matches actions when visible and accessibility labels repeat", () => {
    const submit = detectAts("https://www.totaljobs.com/job/123/application").submitPattern;
    expect(
      matchesApplicationAction(submit, [
        "Send application",
        null,
        "Send application",
      ]),
    ).toBe(true);
    expect(
      matchesApplicationAction(submit, [
        "Good fit",
        null,
        "View job fit details",
      ]),
    ).toBe(false);
  });

  it("uses provider-specific application controls instead of one generic rule", () => {
    const greenhouse = detectAts("https://boards.greenhouse.io/company/jobs/1");
    expect(greenhouse.applyPattern.test("Apply for this job")).toBe(true);
    expect(greenhouse.submitPattern.test("Submit Application")).toBe(true);
    expect(greenhouse.submitPattern.test("Apply now")).toBe(false);

    const smartRecruiters = detectAts(
      "https://jobs.smartrecruiters.com/company/role",
    );
    expect(smartRecruiters.applyPattern.test("I'm interested")).toBe(true);
    expect(smartRecruiters.submitPattern.test("Submit Application")).toBe(true);

    const workday = detectAts(
      "https://company.wd1.myworkdaysite.com/en-US/jobs/job/role",
    );
    expect(workday.kind).toBe("workday");
    expect(workday.applyPattern.test("Apply Manually")).toBe(true);
    expect(workday.submitPattern.test("Submit")).toBe(true);

    const icims = detectAts("https://jobs.example.icims.com/jobs/123");
    expect(icims.applyPattern.test("Apply for this job online")).toBe(true);
    expect(icims.submitPattern.test("Submit Profile")).toBe(true);

    const successFactors = detectAts(
      "https://company.successfactors.com/career?job=123",
    );
    expect(successFactors.submitPattern.test("Apply")).toBe(true);

    const adp = detectAts("https://workforcenow.adp.com/job/1");
    expect(adp.submitPattern.test("Submit my application")).toBe(true);

    const jobvite = detectAts("https://jobs.example.jobvite.com/job/1");
    expect(jobvite.successPattern.test("Thanks for your application")).toBe(true);

    const ukg = detectAts("https://jobs.example.ukg.com/job/1");
    expect(ukg.nextPattern.test("Review and submit")).toBe(true);

    const dayforce = detectAts("https://example.dayforcehcm.com/job/1");
    expect(dayforce.submitPattern.test("Complete application")).toBe(true);

    const pinpoint = detectAts("https://example.pinpointhq.com/job/1");
    expect(pinpoint.applyPattern.test("Apply for this role")).toBe(true);

    const rippling = detectAts("https://ats.rippling.com/example/job/1");
    expect(rippling.successPattern.test("Application received")).toBe(true);
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

  it("uses explicit permission only for required employer terms", () => {
    expect(
      canAutomaticallyAcceptEmployerTerms({
        label: "I agree to the Terms and Conditions",
        required: true,
        consent: true,
      }),
    ).toBe(true);
    expect(
      canAutomaticallyAcceptEmployerTerms({
        label: "Send me marketing offers",
        required: true,
        consent: true,
      }),
    ).toBe(false);
    expect(
      canAutomaticallyAcceptEmployerTerms({
        label: "I agree to the Privacy Notice",
        required: false,
        consent: true,
      }),
    ).toBe(false);
  });

  it("does not mistake a pre-account saved page for an existing account", () => {
    expect(preferEmployerSignIn({ accountAlreadyExists: false })).toBe(false);
    expect(
      preferEmployerSignIn({
        accountAlreadyExists: false,
        accountState: "created",
      }),
    ).toBe(true);
    expect(preferEmployerSignIn({ accountAlreadyExists: true })).toBe(true);
  });

  it("recognises account recovery states without mistaking normal copy", () => {
    expect(
      isEmployerAuthenticationFailure("The password is incorrect. Try again."),
    ).toBe(true);
    expect(
      isEmployerAuthenticationFailure("Welcome back to your candidate account"),
    ).toBe(false);
    expect(
      isEmployerPasswordSetupPage(
        "Choose a new password and confirm your password",
      ),
    ).toBe(true);
    expect(
      isEmployerEmailLinkPending(
        "Check your inbox. We sent a secure sign-in link.",
      ),
    ).toBe(true);
    expect(
      isEmployerEmailLinkPending(
        "An email is on the way! Open the login link sent to apply@example.com to sign in.",
      ),
    ).toBe(true);
    expect(
      isEmployerAccountRecoveryControl("Forgotten your password? Reset it here"),
    ).toBe(true);
    expect(
      isEmployerAccountRecoveryControl("Can't log in? Get sign in help"),
    ).toBe(true);
    expect(isEmployerAccountRecoveryControl("Submit application")).toBe(false);
  });

  it("recognises account-free and passwordless employer application paths", () => {
    expect(isEmployerGuestApplicationControl("Continue as a guest")).toBe(true);
    expect(
      isEmployerGuestApplicationControl("Apply without an account"),
    ).toBe(true);
    expect(isEmployerGuestApplicationControl("Sign in")).toBe(false);
    expect(
      isEmployerPasswordlessAccessControl("Email me a secure sign-in link"),
    ).toBe(true);
    expect(
      isEmployerPasswordlessAccessControl("Send me a one-time code"),
    ).toBe(true);
    expect(isEmployerPasswordlessAccessControl("Create account")).toBe(false);
  });

  it("recognises employer listings that can no longer be submitted", () => {
    expect(
      isClosedListingPage(
        "Senior Data Scientist",
        "This role is no longer accepting applications.",
      ),
    ).toBe(true);
    expect(
      isClosedListingPage(
        "DevOps Engineer",
        "Complete the application form below.",
      ),
    ).toBe(false);
  });

  it("recognises ordinary verification resend controls", () => {
    expect(isVerificationResendControl("Resend code")).toBe(true);
    expect(isVerificationResendControl("Send another code")).toBe(true);
    expect(isVerificationResendControl("Email verification code")).toBe(true);
    expect(isVerificationResendControl("Submit application")).toBe(false);
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
    expect(
      isTrustedApplicationPortalSender(
        "Recruiter <updates@mail.company.co.uk>",
        "https://careers.company.co.uk/role",
      ),
    ).toBe(true);
    expect(
      isTrustedApplicationPortalSender(
        "Fake recruiter <updates@attacker.co.uk>",
        "https://careers.company.co.uk/role",
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
