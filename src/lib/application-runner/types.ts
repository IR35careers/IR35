import type { ApplicationQuestion, ContractorProfile } from "@/lib/workspace/types";

export const FACT_KEYS = [
  "full_name", "first_name", "last_name", "email", "phone", "address", "city", "county",
  "postcode", "country", "location", "linkedin", "portfolio", "availability", "notice_period",
  "right_to_work", "needs_sponsorship", "can_relocate", "can_work_in_person", "can_start_immediately",
  "education_institution", "education_qualification", "security_clearance", "limited_company_name",
] as const;

export type FactKey = typeof FACT_KEYS[number];

export interface RunnerField {
  id: string;
  index: number;
  type: string;
  label: string;
  name: string;
  placeholder: string;
  required: boolean;
  options: string[];
  optionValue: string;
  optionLabel: string;
}

export interface FieldMapping {
  fieldId: string;
  factKey: FactKey | "needs_user" | "skip";
}

export interface RunnerFacts {
  values: Partial<Record<FactKey, string>>;
  screeningAnswers: ApplicationQuestion[];
}

function yesNo(value: boolean | null | undefined): string {
  return value === true ? "Yes" : value === false ? "No" : "";
}

export function buildRunnerFacts(candidate: ContractorProfile, questions: ApplicationQuestion[]): RunnerFacts {
  const name = candidate.fullName.trim().split(/\s+/).filter(Boolean);
  return {
    values: {
      full_name: candidate.fullName,
      first_name: name[0] ?? "",
      last_name: name.slice(1).join(" "),
      email: candidate.email,
      phone: candidate.phone,
      address: candidate.addressLine1 ?? "",
      city: candidate.city ?? "",
      county: candidate.county ?? "",
      postcode: candidate.postcode ?? "",
      country: candidate.country ?? "",
      location: candidate.location,
      linkedin: candidate.linkedInUrl,
      portfolio: candidate.portfolioUrl,
      availability: candidate.availability,
      notice_period: candidate.noticePeriod,
      right_to_work: candidate.rightToWork === "yes" ? "Yes" : candidate.rightToWork === "needs_sponsorship" || candidate.rightToWork === "no" ? "No" : "",
      needs_sponsorship: candidate.rightToWork === "needs_sponsorship" ? "Yes" : candidate.rightToWork === "yes" || candidate.rightToWork === "no" ? "No" : "",
      can_relocate: yesNo(candidate.canRelocate),
      can_work_in_person: yesNo(candidate.canWorkInPerson),
      can_start_immediately: yesNo(candidate.canStartImmediately),
      education_institution: candidate.educationInstitution ?? "",
      education_qualification: candidate.educationQualification ?? "",
      security_clearance: candidate.clearance,
      limited_company_name: candidate.limitedCompanyName,
    },
    screeningAnswers: questions,
  };
}
