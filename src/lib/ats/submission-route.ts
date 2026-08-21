import type { JobDetail } from "@/lib/job-types";

export type AtsProvider = "ashby" | "greenhouse" | "lever" | "smartrecruiters" | "workday" | "other";

export interface SubmissionRoute {
  provider: AtsProvider;
  label: string;
  destinationHost: string;
  needsInteractiveBrowser: boolean;
}

export function detectSubmissionRoute(job: Pick<JobDetail, "apply_url" | "source_domain">): SubmissionRoute {
  let destinationHost = job.source_domain.toLowerCase();
  try {
    destinationHost = new URL(job.apply_url).hostname.toLowerCase();
  } catch {
    // The submit API performs the authoritative URL validation.
  }

  if (destinationHost.includes("ashbyhq.com")) {
    return { provider: "ashby", label: "Ashby", destinationHost, needsInteractiveBrowser: true };
  }
  if (destinationHost.includes("greenhouse.io")) {
    return { provider: "greenhouse", label: "Greenhouse", destinationHost, needsInteractiveBrowser: true };
  }
  if (destinationHost.includes("lever.co")) {
    return { provider: "lever", label: "Lever", destinationHost, needsInteractiveBrowser: true };
  }
  if (destinationHost.includes("smartrecruiters.com")) {
    return { provider: "smartrecruiters", label: "SmartRecruiters", destinationHost, needsInteractiveBrowser: true };
  }
  if (destinationHost.includes("myworkdayjobs.com") || destinationHost.includes("workday.com")) {
    return { provider: "workday", label: "Workday", destinationHost, needsInteractiveBrowser: true };
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
