/**
 * Reed.co.uk fetcher — the biggest single source of UK contract roles.
 *
 * Official public API: https://www.reed.co.uk/api (free key, instant signup).
 * Auth: HTTP Basic with the API key as username, empty password.
 *
 * We search with `contract=true`, which scopes results to contract roles as
 * classified by Reed — including inside IR35, outside IR35, and
 * status-unstated roles (the processing engine classifies IR35 separately;
 * the site's filters let users pick inside/outside/unknown).
 *
 * Endpoint:
 *   GET https://www.reed.co.uk/api/1.0/search
 *     ?keywords=...&contract=true&resultsToTake=100&resultsToSkip=N
 *
 * Response: { results: [ { jobId, employerName, jobTitle, locationName,
 *   minimumSalary, maximumSalary, currency, date (dd/MM/yyyy),
 *   expirationDate, jobDescription, jobUrl, applications } ], totalResults }
 *
 * Notes:
 * - For contract roles, minimum/maximumSalary usually carry the advertised
 *   day rate (e.g. 500) — the rate parser's magnitude inference labels
 *   150–3,000 as daily. Annual figures (20k+) are labelled annual.
 * - jobDescription in search results is truncated; enough for IR35/skills
 *   detection in most ads (recruiters front-load "Outside IR35" and rates).
 */

import { HttpClient } from "./http-client";
import type { RawATSJob } from "./types";

interface ReedJob {
  jobId: number;
  employerName?: string;
  jobTitle?: string;
  locationName?: string;
  minimumSalary?: number | null;
  maximumSalary?: number | null;
  currency?: string | null;
  date?: string; // dd/MM/yyyy
  expirationDate?: string;
  jobDescription?: string;
  jobUrl?: string;
}

interface ReedResponse {
  results: ReedJob[];
  totalResults?: number;
}

/** Broad role families; contract=true does the contract scoping. */
export const DEFAULT_REED_QUERIES = [
  "software engineer",
  "developer",
  "data engineer",
  "data analyst",
  "devops",
  "cloud engineer",
  "project manager",
  "business analyst",
  "architect",
  "cyber security",
  "test engineer",
  "product manager",
];

/** Parse Reed's dd/MM/yyyy into ISO, or null. */
export function parseReedDate(date: string | undefined): string | null {
  if (!date) return null;
  const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd))).toISOString();
}

export function mapReedJob(job: ReedJob): RawATSJob {
  const min = job.minimumSalary ?? null;
  const max = job.maximumSalary ?? null;
  const currency = job.currency ?? "GBP";
  const rawSalary =
    min !== null || max !== null ? `${currency} ${min ?? ""}-${max ?? ""}`.trim() : "";

  // Reed's contract=true filter is authoritative — surface it as text so the
  // processing engine's contract gate accepts even sparse descriptions.
  const description = ["Employment type: Contract.", job.jobDescription ?? ""]
    .filter(Boolean)
    .join("\n\n");

  return {
    sourceDomain: "reed.co.uk",
    sourceIdentifier: String(job.jobId),
    sourceType: "reed",
    title: job.jobTitle ?? "",
    companyName: job.employerName?.trim() || "Via Reed",
    description,
    location: job.locationName ?? "",
    rawSalary,
    applyUrl: job.jobUrl ?? `https://www.reed.co.uk/jobs/${job.jobId}`,
    postedAt: parseReedDate(job.date),
    rawPayload: job,
  };
}

/**
 * Fetch contract roles from Reed across the given keyword queries.
 * One page (100 results) per query keeps the total run inside the
 * serverless time budget; raise PAGES_PER_QUERY if you move off Hobby.
 */
export async function fetchReed(
  client: HttpClient,
  apiKey: string,
  queries: string[] = DEFAULT_REED_QUERIES
): Promise<RawATSJob[]> {
  const PAGES_PER_QUERY = 1;
  const TAKE = 100;
  const authHeader = { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` };

  const jobs: RawATSJob[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    for (let page = 0; page < PAGES_PER_QUERY; page++) {
      const url =
        `https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(query)}` +
        `&contract=true&resultsToTake=${TAKE}&resultsToSkip=${page * TAKE}`;
      const data = await client.getJson<ReedResponse>(url, { headers: authHeader });
      const results = Array.isArray(data?.results) ? data.results : [];
      for (const job of results) {
        const id = String(job.jobId);
        if (seen.has(id)) continue; // queries overlap; dedupe within the run
        seen.add(id);
        jobs.push(mapReedJob(job));
      }
      if (results.length < TAKE) break;
    }
  }
  return jobs;
}
