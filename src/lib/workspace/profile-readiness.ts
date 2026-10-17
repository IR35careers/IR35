import type { ContractorProfile } from "@/lib/workspace/types";

export interface ProfileReadinessItem {
  id: string;
  label: string;
  section:
    "contact" | "professional" | "eligibility" | "preferences" | "history" | "cv";
  complete: boolean;
}

export type ProfileReadinessNavigation =
  | "identity"
  | "experience"
  | "answers"
  | "resume";

export interface ProfileReadinessDestination {
  navigation: ProfileReadinessNavigation;
  targetId: string;
}

export interface ProfileReadinessResult {
  items: ProfileReadinessItem[];
  missing: ProfileReadinessItem[];
  complete: boolean;
  percentage: number;
}

/**
 * Only facts that are required to create a truthful application packet belong
 * in this set. Employer-specific facts (address, travel, background checks,
 * shifts, relocation, and similar answers) are deliberately collected by the
 * runner only when a particular employer asks for them. Requiring every
 * possible answer before a contractor can even start made otherwise valid
 * profiles stall at 92% completion.
 */
export const APPLICATION_READINESS_ITEM_IDS = [
  "full-name",
  "phone",
  "email",
  "cv",
] as const;

const APPLICATION_READINESS_ITEMS = new Set<string>(
  APPLICATION_READINESS_ITEM_IDS,
);

export interface ProfileReadinessBlocker {
  action: "/profile";
  message: string;
}

function answered(value: unknown): boolean {
  return value !== "" && value !== null && value !== undefined;
}

export function evaluateProfileReadiness(
  profile: ContractorProfile,
  resumeText = "",
): ProfileReadinessResult {
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
      id: "email",
      label: "Contact email",
      section: "contact",
      complete: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim()),
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
      id: "target-role",
      label: "Current or target role",
      section: "professional",
      complete: Boolean(profile.targetRole?.trim()),
    },
    {
      id: "skills",
      label: "At least three confirmed skills",
      section: "professional",
      complete: (profile.skills?.filter((skill) => skill.trim()).length ?? 0) >= 3,
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
      id: "cv",
      label: "Primary Resume",
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

export function evaluateApplicationReadiness(
  profile: ContractorProfile,
  resumeText = "",
): ProfileReadinessResult {
  const profileReadiness = evaluateProfileReadiness(profile, resumeText);
  const items = profileReadiness.items.filter((item) =>
    APPLICATION_READINESS_ITEMS.has(item.id),
  );
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

export function profileReadinessBlocker(
  readiness: ProfileReadinessResult,
): ProfileReadinessBlocker | null {
  if (readiness.complete) return null;
  return {
    action: "/profile",
    message: `Complete your Application Profile: ${readiness.missing.map((item) => item.label).join(", ")}.`,
  };
}

/**
 * Route a missing readiness answer to the exact control that can resolve it.
 * Keep this mapping explicit: broad section-based routing previously sent the
 * age-eligibility task to Experience even though the answer lives in the
 * reusable application-answer section.
 */
export function profileReadinessDestination(
  itemId: string,
): ProfileReadinessDestination | null {
  const destinations: Record<string, ProfileReadinessDestination> = {
    "full-name": { navigation: "identity", targetId: "profile-field-full-name" },
    phone: { navigation: "identity", targetId: "profile-field-phone" },
    email: { navigation: "identity", targetId: "profile-field-email" },
    address: { navigation: "answers", targetId: "profile-field-address" },
    "target-role": { navigation: "identity", targetId: "profile-field-target-role" },
    skills: { navigation: "identity", targetId: "profile-field-skills" },
    "right-to-work": { navigation: "experience", targetId: "profile-field-right-to-work" },
    "over-18": { navigation: "answers", targetId: "profile-field-over-18" },
    availability: { navigation: "experience", targetId: "profile-field-availability" },
    "working-preferences": { navigation: "answers", targetId: "profile-field-working-preferences" },
    "workplace-needs": { navigation: "answers", targetId: "profile-field-workplace-needs" },
    background: { navigation: "answers", targetId: "profile-field-background" },
    cv: { navigation: "resume", targetId: "profile-resume" },
  };
  return destinations[itemId] ?? null;
}
