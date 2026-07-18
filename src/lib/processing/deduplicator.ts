/**
 * Deduplicator
 *
 * Tier 1 (deterministic) lives in the database: a unique constraint on
 * (source_domain, source_identifier) makes re-fetches of the same posting an
 * upsert, not a duplicate. Free and exact.
 *
 * Tier 2 (fuzzy, this file) catches the same real-world role appearing under
 * different source identifiers — e.g. posted natively by the company and
 * again by an agency, or reposted with a tweaked title. Weighted similarity:
 *
 *   title    40%  (max of Levenshtein similarity and token containment —
 *                  see titleSimilarity for why both are needed)
 *   company  20%  (exact case-insensitive match, else Levenshtein)
 *   rate     25%  (proportional closeness of midpoints; neutral 0.5 if unknown)
 *   location 15%  (exact match, else Levenshtein)
 *
 * Default threshold 0.92: catches "Senior React Developer" vs "Senior React
 * Developer – 6 Month Contract" at the same company/rate/location (~0.98),
 * while "Senior React Developer" vs "Senior Vue Developer" at identical
 * company/rate/location stays just under (~0.91) — genuinely different roles
 * are never merged. Tune via the threshold parameter if needed.
 */

export interface DedupCandidate {
  title: string;
  company_name: string;
  rate_min: number | null;
  rate_max: number | null;
  location: string;
}

/** Iterative two-row Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 0..1 string similarity based on Levenshtein distance. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x.length && !y.length) return 1;
  const maxLen = Math.max(x.length, y.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(x, y) / maxLen;
}

/**
 * Title similarity = max(Levenshtein similarity, token containment × 0.95).
 *
 * Pure Levenshtein punishes suffix additions brutally: "Senior React
 * Developer" vs "Senior React Developer – 6 Month Contract" scores only
 * ~0.56 despite being the same role. Token containment (what fraction of the
 * shorter title's words appear in the longer one) recovers that case — full
 * containment scores 0.95, deliberately just below a verbatim match.
 */
export function titleSimilarity(a: string, b: string): number {
  const lev = similarity(a, b);
  const ta = new Set(normalize(a).split(" ").filter(Boolean));
  const tb = new Set(normalize(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return lev;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let overlap = 0;
  for (const token of small) if (large.has(token)) overlap++;
  const containment = overlap / small.size;
  return Math.max(lev, containment * 0.95);
}

function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function rateMidpoint(job: DedupCandidate): number | null {
  if (job.rate_min !== null && job.rate_max !== null) return (job.rate_min + job.rate_max) / 2;
  return job.rate_min ?? job.rate_max ?? null;
}

/** Weighted similarity score between two jobs, 0..1. */
export function jobSimilarity(a: DedupCandidate, b: DedupCandidate): number {
  const titleScore = titleSimilarity(a.title, b.title);

  const companyScore =
    normalize(a.company_name) === normalize(b.company_name)
      ? 1
      : similarity(a.company_name, b.company_name);

  const ra = rateMidpoint(a);
  const rb = rateMidpoint(b);
  let rateScore: number;
  if (ra === null || rb === null) {
    rateScore = 0.5; // unknown on either side: neutral, neither confirms nor denies
  } else if (ra === 0 && rb === 0) {
    rateScore = 1;
  } else {
    rateScore = 1 - Math.abs(ra - rb) / Math.max(ra, rb);
  }

  const locationScore =
    normalize(a.location) === normalize(b.location) ? 1 : similarity(a.location, b.location);

  return titleScore * 0.4 + companyScore * 0.2 + rateScore * 0.25 + locationScore * 0.15;
}

/**
 * Find the first existing job that fuzzy-matches the candidate above the
 * threshold. Callers should pass only same-company (or all recent active)
 * jobs to keep comparisons cheap.
 */
export function findFuzzyDuplicate<T extends DedupCandidate>(
  candidate: DedupCandidate,
  existing: T[],
  threshold = 0.92
): T | null {
  for (const job of existing) {
    if (jobSimilarity(candidate, job) >= threshold) return job;
  }
  return null;
}
