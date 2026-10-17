import { describe, expect, it } from "vitest";
import {
  disableEmployerAutomation,
  EMPLOYER_AUTOMATION_CONSENT_VERSION,
  enableEmployerAutomation,
} from "@/lib/application-automation-consent";
import { createSeedWorkspaceState } from "@/lib/workspace/seed";

describe("employer automation consent", () => {
  it("records one explicit permission for accounts, required terms and codes", () => {
    const acceptedAt = "2026-08-23T04:30:00.000Z";
    const profile = enableEmployerAutomation(
      {
        ...createSeedWorkspaceState().profile,
        portalAccountConsent: false,
        employerTermsConsent: false,
        automaticEmailVerification: false,
      },
      acceptedAt,
    );

    expect(profile).toMatchObject({
      portalAccountConsent: true,
      employerTermsConsent: true,
      automaticEmailVerification: true,
      employerAutomationConsentAt: acceptedAt,
      employerAutomationConsentVersion: EMPLOYER_AUTOMATION_CONSENT_VERSION,
    });
  });

  it("revokes every linked employer automation permission together", () => {
    const profile = disableEmployerAutomation(
      enableEmployerAutomation(createSeedWorkspaceState().profile),
    );

    expect(profile).toMatchObject({
      portalAccountConsent: false,
      employerTermsConsent: false,
      automaticEmailVerification: false,
    });
    expect(profile.employerAutomationConsentAt).toBeUndefined();
    expect(profile.employerAutomationConsentVersion).toBeUndefined();
  });
});
