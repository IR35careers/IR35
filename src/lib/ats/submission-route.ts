import type { JobDetail } from "@/lib/job-types";

export type AtsProvider =
  | "ashby"
  | "greenhouse"
  | "lever"
  | "smartrecruiters"
  | "workday"
  | "workable"
  | "totaljobs"
  | "icims"
  | "oracle"
  | "adp"
  | "bamboohr"
  | "jobvite"
  | "ukg"
  | "successfactors"
  | "dayforce"
  | "teamtailor"
  | "recruitee"
  | "pinpoint"
  | "rippling"
  | "other";

export interface SubmissionRoute {
  provider: AtsProvider;
  label: string;
  destinationHost: string;
  needsInteractiveBrowser: boolean;
}

const ATS_ROUTES: Array<{
  provider: Exclude<AtsProvider, "other">;
  label: string;
  domains: string[];
}> = [
  { provider: "ashby", label: "Ashby", domains: ["ashbyhq.com"] },
  { provider: "greenhouse", label: "Greenhouse", domains: ["greenhouse.io"] },
  { provider: "lever", label: "Lever", domains: ["lever.co"] },
  { provider: "smartrecruiters", label: "SmartRecruiters", domains: ["smartrecruiters.com"] },
  { provider: "workday", label: "Workday", domains: ["myworkdayjobs.com", "myworkday.com", "workday.com"] },
  { provider: "workable", label: "Workable", domains: ["workable.com"] },
  { provider: "totaljobs", label: "Totaljobs", domains: ["totaljobs.com"] },
  { provider: "icims", label: "iCIMS", domains: ["icims.com"] },
  { provider: "oracle", label: "Oracle Recruiting", domains: ["oraclecloud.com", "taleo.net"] },
  { provider: "adp", label: "ADP", domains: ["adp.com"] },
  { provider: "bamboohr", label: "BambooHR", domains: ["bamboohr.com"] },
  { provider: "jobvite", label: "Jobvite", domains: ["jobvite.com"] },
  { provider: "ukg", label: "UKG", domains: ["ultipro.com", "ukg.com"] },
  { provider: "successfactors", label: "SAP SuccessFactors", domains: ["successfactors.com"] },
  { provider: "dayforce", label: "Dayforce", domains: ["dayforcehcm.com"] },
  { provider: "teamtailor", label: "Teamtailor", domains: ["teamtailor.com"] },
  { provider: "recruitee", label: "Recruitee", domains: ["recruitee.com"] },
  { provider: "pinpoint", label: "Pinpoint", domains: ["pinpointhq.com"] },
  { provider: "rippling", label: "Rippling", domains: ["rippling.com"] },
];

export function detectSubmissionRoute(job: Pick<JobDetail, "apply_url" | "source_domain">): SubmissionRoute {
  let destinationHost = job.source_domain.toLowerCase();
  try {
    destinationHost = new URL(job.apply_url).hostname.toLowerCase();
  } catch {
    // The submit API performs the authoritative URL validation.
  }

  const recognisedRoute = ATS_ROUTES.find((route) =>
    route.domains.some(
      (domain) =>
        destinationHost === domain || destinationHost.endsWith(`.${domain}`),
    ),
  );
  if (recognisedRoute) {
    return {
      provider: recognisedRoute.provider,
      label: recognisedRoute.label,
      destinationHost,
      needsInteractiveBrowser: true,
    };
  }
  return { provider: "other", label: "Employer website", destinationHost, needsInteractiveBrowser: true };
}

export function roleTypeWarning(job: Pick<JobDetail, "title" | "description" | "rate_type">): string | null {
  const evidence = `${job.title}\n${job.description}`;
  if (job.rate_type === "annual" || /\b(?:full[- ]?time|fixed[- ]?term|\bFTC\b|permanent)\b/i.test(evidence)) {
    return "This listing appears to be a salaried or fixed-term role rather than a day-rate contract. Check the engagement type and IR35 relevance before applying.";
  }
  return null;
}
