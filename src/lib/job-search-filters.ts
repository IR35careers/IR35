export type SeniorityFilter = "entry" | "senior" | "lead" | "manager";
export type RateTypeFilter = "daily" | "hourly" | "annual";

export const SENIORITY_FILTER_OPTIONS: ReadonlyArray<{ value: SeniorityFilter; label: string }> = [
  { value: "entry", label: "Junior / graduate" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead / principal" },
  { value: "manager", label: "Manager / head" },
];

export const RATE_TYPE_FILTER_OPTIONS: ReadonlyArray<{ value: RateTypeFilter; label: string }> = [
  { value: "daily", label: "Day rate" },
  { value: "hourly", label: "Hourly rate" },
  { value: "annual", label: "Annual / FTC rate" },
];

const SENIORITY_PATTERNS: Record<SeniorityFilter, RegExp> = {
  entry: /\b(?:junior|graduate|entry[ -]level|trainee|intern)\b/i,
  senior: /\b(?:senior|sr)\b/i,
  lead: /\b(?:lead|principal|staff engineer|architect)\b/i,
  manager: /\b(?:manager|head of|director|chief|vice president)\b/i,
};

const SENIORITY_POSTGREST: Record<SeniorityFilter, string> = {
  entry: "title.ilike.%junior%,title.ilike.%graduate%,title.ilike.%entry level%,title.ilike.%entry-level%,title.ilike.%trainee%,title.ilike.%intern%",
  senior: "title.ilike.%senior%,title.ilike.%sr %",
  lead: "title.ilike.%lead %,title.ilike.% lead,title.ilike.%principal%,title.ilike.%staff engineer%,title.ilike.%architect%",
  manager: "title.ilike.%manager%,title.ilike.%head of%,title.ilike.%director%,title.ilike.%chief%,title.ilike.%vice president%",
};

export const SPONSORSHIP_POSTGREST = [
  "description.ilike.%visa sponsorship available%",
  "description.ilike.%visa sponsorship is available%",
  "description.ilike.%sponsorship offered%",
  "description.ilike.%sponsorship is offered%",
  "description.ilike.%sponsorship provided%",
  "description.ilike.%sponsorship is provided%",
  "description.ilike.%we can sponsor%",
  "description.ilike.%we will sponsor%",
].join(",");

const SPONSORSHIP_PATTERNS = [
  /\bvisa sponsorship (?:is )?available\b/i,
  /\bsponsorship (?:is )?(?:offered|provided)\b/i,
  /\bwe (?:can|will) sponsor\b/i,
];

export function isSeniorityFilter(value: string): value is SeniorityFilter {
  return value === "entry" || value === "senior" || value === "lead" || value === "manager";
}

export function isRateTypeFilter(value: string): value is RateTypeFilter {
  return value === "daily" || value === "hourly" || value === "annual";
}

export function matchesSeniorityTitle(title: string, filter: SeniorityFilter): boolean {
  return SENIORITY_PATTERNS[filter].test(title);
}

export function seniorityPostgrestFilter(filter: SeniorityFilter): string {
  return SENIORITY_POSTGREST[filter];
}

export function hasStatedSponsorship(description: string): boolean {
  return SPONSORSHIP_PATTERNS.some((pattern) => pattern.test(description));
}
