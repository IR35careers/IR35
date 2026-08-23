import type { ContractorProfile } from "@/lib/workspace/types";

export const EMPLOYER_AUTOMATION_CONSENT_VERSION = "2026-08-23";

export function enableEmployerAutomation(
  profile: ContractorProfile,
  acceptedAt = new Date().toISOString(),
): ContractorProfile {
  return {
    ...profile,
    portalAccountConsent: true,
    employerTermsConsent: true,
    automaticEmailVerification: true,
    employerAutomationConsentAt: acceptedAt,
    employerAutomationConsentVersion: EMPLOYER_AUTOMATION_CONSENT_VERSION,
  };
}

export function disableEmployerAutomation(
  profile: ContractorProfile,
): ContractorProfile {
  return {
    ...profile,
    portalAccountConsent: false,
    employerTermsConsent: false,
    automaticEmailVerification: false,
    employerAutomationConsentAt: undefined,
    employerAutomationConsentVersion: undefined,
  };
}
