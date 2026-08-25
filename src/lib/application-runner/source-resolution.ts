import type { JobDetail } from "@/lib/job-types";

export type DiscoveryProvider = "cv_library" | "totaljobs";

const DISCOVERY_ONLY_DOMAINS = [
  "adzuna.co.uk",
  "reed.co.uk",
  "cv-library.co.uk",
  "totaljobs.com",
  "jobserve.com",
  "gumtree.com",
  "talent.com",
  "jooble.org",
  "contractoruk.com",
  "itjobswatch.co.uk",
  "opentalent.in",
  "haystack.cv",
  "devitjobs.uk",
  "joinhyra.com",
] as const;

const COMPANY_NOISE_WORDS = new Set([
  "and",
  "company",
  "group",
  "international",
  "limited",
  "ltd",
  "plc",
  "recruitment",
  "solutions",
  "technology",
  "technologies",
  "the",
  "uk",
]);

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

export function isDiscoveryOnlyHost(host: string): boolean {
  const normalised = host.toLowerCase().replace(/^www\./, "");
  return DISCOVERY_ONLY_DOMAINS.some((domain) =>
    hostMatches(normalised, domain),
  );
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

function decodeSearchHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts only public result labels and destinations from DuckDuckGo's
 * no-script HTML response. No candidate data is involved in this lookup.
 */
export function directEmployerCandidatesFromSearchHtml(
  html: string,
): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchors) {
    const attributes = match[1] ?? "";
    const className = attributes.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? "";
    if (!/(?:^|\s)result__a(?:\s|$)/i.test(className)) continue;
    const encodedHref = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? "";
    const href = duckDuckGoResultTarget(decodeSearchHtml(encodedHref));
    const title = decodeSearchHtml(match[2] ?? "");
    if (!href || !title || seen.has(href)) continue;
    seen.add(href);
    candidates.push({ title, context: title, href });
    if (candidates.length >= 12) break;
  }
  return candidates;
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
    (candidateContext.includes(company) ||
      overlap(company, candidate.context) >= 0.8),
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

export function duckDuckGoResultTarget(href: string): string | null {
  try {
    const parsed = new URL(href, "https://html.duckduckgo.com");
    const target = hostMatches(parsed.hostname.toLowerCase(), "duckduckgo.com")
      ? parsed.searchParams.get("uddg")
      : parsed.toString();
    if (!target) return null;
    const destination = new URL(target);
    if (
      destination.protocol !== "https:" ||
      isDiscoveryOnlyHost(destination.hostname)
    )
      return null;
    return destination.toString();
  } catch {
    return null;
  }
}

function companyHostMatched(company: string, hostname: string): boolean {
  const host = compact(hostname);
  return compact(company)
    .split(" ")
    .filter((token) => token.length >= 3 && !COMPANY_NOISE_WORDS.has(token))
    .some((token) => host.includes(token));
}

export function directEmployerCandidateScore(
  candidate: DiscoveryCandidate,
  job: Pick<JobDetail, "title" | "company_name" | "location"> &
    Partial<Pick<JobDetail, "description">>,
): number {
  let destination: URL;
  try {
    destination = new URL(candidate.href);
  } catch {
    return 0;
  }
  if (
    destination.protocol !== "https:" ||
    isDiscoveryOnlyHost(destination.hostname)
  )
    return 0;

  const titleOverlap = overlap(job.title, candidate.title);
  if (titleOverlap < 0.72) return 0;
  const directAts = DIRECT_APPLICATION_DOMAINS.some((domain) =>
    hostMatches(destination.hostname.toLowerCase(), domain),
  );
  if (!directAts && !companyHostMatched(job.company_name, destination.hostname))
    return 0;

  const exactTitle = compact(candidate.title) === compact(job.title);
  const location = job.location.split(",")[0] ?? job.location;
  const locationMatched = overlap(location, candidate.context) >= 0.5;
  const descriptionMatched = job.description
    ? overlap(job.description, candidate.context)
    : 0;
  return Math.round(
    (exactTitle ? 70 : titleOverlap * 60) +
      (directAts ? 20 : 25) +
      (locationMatched ? 5 : 0) +
      descriptionMatched * 20,
  );
}

export function bestDirectEmployerCandidate(
  candidates: DiscoveryCandidate[],
  job: Pick<JobDetail, "title" | "company_name" | "location"> &
    Partial<Pick<JobDetail, "description">>,
): DiscoveryCandidate | null {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: directEmployerCandidateScore(candidate, job),
    }))
    .filter((entry) => entry.score >= 75)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0].candidate;
}
