import type { JobDetail } from "@/lib/job-types";

export type DiscoveryProvider = "cv_library" | "totaljobs";

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

export interface DiscoveryCandidate {
  title: string;
  context: string;
  href: string;
}

export function discoveryCandidateScore(
  candidate: DiscoveryCandidate,
  job: Pick<JobDetail, "title" | "company_name" | "location">,
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
  return Math.round(
    (exactTitle ? 70 : titleOverlap * 60) +
      25 +
      (locationMatched ? 5 : 0),
  );
}

export function bestDiscoveryCandidate(
  candidates: DiscoveryCandidate[],
  job: Pick<JobDetail, "title" | "company_name" | "location">,
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
