import type { JobDetail } from "@/lib/job-types";

export type DiscoveryProvider = "cv_library" | "totaljobs";

const DIRECT_APPLICATION_DOMAINS = [
  "greenhouse.io",
  "greenhouse.com",
  "lever.co",
  "lever.com",
  "ashbyhq.com",
  "workable.com",
  "smartrecruiters.com",
  "myworkdayjobs.com",
  "myworkday.com",
  "workday.com",
  "totaljobs.com",
  "icims.com",
  "oraclecloud.com",
  "taleo.net",
  "adp.com",
  "bamboohr.com",
  "jobvite.com",
  "ultipro.com",
  "ukg.com",
  "successfactors.com",
  "dayforcehcm.com",
  "teamtailor.com",
  "recruitee.com",
  "pinpointhq.com",
  "rippling.com",
] as const;

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function compact(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    compact(value)
      .split(" ")
      .filter((token) => token.length > 1),
  );
}

function overlap(left: string, right: string): number {
  const expected = tokens(left);
  const actual = tokens(right);
  if (!expected.size || !actual.size) return 0;
  let matches = 0;
  for (const token of expected) if (actual.has(token)) matches += 1;
  return matches / expected.size;
}

export function discoveryProviderFromAdzunaPage(input: {
  body: string;
  html: string;
}): DiscoveryProvider | null {
  const evidence = `${input.body} ${input.html}`;
  if (/(?:cv[\s-]?library|logo_cv_library)/i.test(evidence))
    return "cv_library";
  if (/(?:totaljobs|total jobs)/i.test(evidence)) return "totaljobs";
  return null;
}

/** Recovery order when an aggregator page hides or omits its source. */
export function discoveryProviderOrder(input: {
  body: string;
  html: string;
}): DiscoveryProvider[] {
  const detected = discoveryProviderFromAdzunaPage(input);
  if (!detected) return ["totaljobs", "cv_library"];
  return detected === "totaljobs"
    ? ["totaljobs", "cv_library"]
    : ["cv_library", "totaljobs"];
}

/** Prefer direct employer forms over discovery links for hands-free runs. */
export function automaticSubmissionPriority(
  job: Pick<JobDetail, "apply_url" | "source_domain">,
): number {
  let host: string;
  try {
    host = new URL(job.apply_url).hostname.toLowerCase();
  } catch {
    return 0;
  }
  if (DIRECT_APPLICATION_DOMAINS.some((domain) => hostMatches(host, domain)))
    return 300;
  if (hostMatches(host, "cv-library.co.uk")) return 240;
  if (hostMatches(host, "reed.co.uk")) return 180;
  if (hostMatches(host, "adzuna.co.uk")) return 120;
  return 80;
}

export interface DiscoveryCandidate {
  title: string;
  context: string;
  href: string;
}

export function discoveryCandidateScore(
  candidate: DiscoveryCandidate,
  job: Pick<JobDetail, "title" | "company_name" | "location"> &
    Partial<Pick<JobDetail, "description">>,
): number {
  const titleOverlap = overlap(job.title, candidate.title);
  if (titleOverlap < 0.72) return 0;

  const candidateContext = compact(candidate.context);
  const company = compact(job.company_name);
  const companyMatched = Boolean(
    company &&
      (candidateContext.includes(company) || overlap(company, candidate.context) >= 0.8),
  );
  if (!companyMatched) return 0;

  const exactTitle = compact(candidate.title) === compact(job.title);
  const location = job.location.split(",")[0] ?? job.location;
  const locationMatched = overlap(location, candidate.context) >= 0.5;
  const descriptionMatched = job.description
    ? overlap(job.description, candidate.context)
    : 0;
  return Math.round(
    (exactTitle ? 70 : titleOverlap * 60) +
      25 +
      (locationMatched ? 5 : 0) +
      descriptionMatched * 20,
  );
}

export function bestDiscoveryCandidate(
  candidates: DiscoveryCandidate[],
  job: Pick<JobDetail, "title" | "company_name" | "location"> &
    Partial<Pick<JobDetail, "description">>,
): DiscoveryCandidate | null {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: discoveryCandidateScore(candidate, job),
    }))
    .filter((entry) => entry.score >= 75)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0].candidate;
}
