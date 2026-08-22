import type { ContractorProfile } from "@/lib/workspace/types";

export interface ProfileReadinessItem {
  id: string;
  label: string;
  section:
    "contact" | "eligibility" | "preferences" | "history" | "automation" | "cv";
  complete: boolean;
}

function answered(value: unknown): boolean {
  return value !== "" && value !== null && value !== undefined;
}

export function evaluateProfileReadiness(
  profile: ContractorProfile,
  resumeText = "",
) {
  const items: ProfileReadinessItem[] = [
    {
      id: "full-name",
      label: "Full legal name",
      section: "contact",
      complete: profile.fullName.trim().split(/\s+/).length >= 2,
    },
    {
      id: "phone",
      label: "Phone number",
      section: "contact",
      complete: profile.phone.trim().length >= 7,
    },
    {
      id: "address",
      label: "Address",
      section: "contact",
      complete: Boolean(
        profile.addressLine1?.trim() &&
        profile.city?.trim() &&
        profile.postcode?.trim() &&
        profile.country?.trim(),
      ),
    },
    {
      id: "right-to-work",
      label: "UK work authorisation",
      section: "eligibility",
      complete: profile.rightToWork !== "prefer_not_to_say",
    },
    {
      id: "over-18",
      label: "Age eligibility",
      section: "eligibility",
      complete: answered(profile.isOver18),
    },
    {
      id: "availability",
      label: "Availability and notice period",
      section: "preferences",
      complete: Boolean(
        profile.availability.trim() && profile.noticePeriod.trim(),
      ),
    },
    {
      id: "working-preferences",
      label: "Location, relocation and start preferences",
      section: "preferences",
      complete: [
        profile.canWorkInPerson,
        profile.canRelocate,
        profile.canStartImmediately,
        profile.hasTransportation,
        profile.willingToTravel,
        profile.willingToWorkShifts,
        profile.willingToWorkWeekends,
      ].every(answered),
    },
    {
      id: "workplace-needs",
      label: "Workplace accommodation answer",
      section: "preferences",
      complete: answered(profile.needsAccommodation),
    },
    {
      id: "background",
      label: "Employment and background answers",
      section: "history",
      complete: [
        profile.workedForCompanyBefore,
        profile.hasGovernmentClearance,
        profile.hasGovernmentTies,
        profile.backgroundCheckConsent,
        profile.criminalConvictionsToDeclare,
      ].every(answered),
    },
    {
      id: "portal-consent",
      label: "Employer account and email verification permission",
      section: "automation",
      complete:
        profile.portalAccountConsent === true &&
        profile.automaticEmailVerification === true,
    },
    {
      id: "cv",
      label: "Primary CV",
      section: "cv",
      complete: resumeText.trim().length >= 120,
    },
  ];
  const missing = items.filter((item) => !item.complete);
  return {
    items,
    missing,
    complete: missing.length === 0,
    percentage: Math.round(
      ((items.length - missing.length) / items.length) * 100,
    ),
  };
}
