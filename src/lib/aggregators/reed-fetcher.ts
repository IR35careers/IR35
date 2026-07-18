/**
 * Reed.co.uk fetcher — agency-posted UK contract jobs at real volume.
 *
 * Endpoint: https://www.reed.co.uk/api/1.0/search
 * Auth: HTTP Basic with your API key as username, blank password.
 * Get a free key instantly at https://www.reed.co.uk/developers/jobseeker
 *
 * We query with contract=true so ONLY contract roles come back — the
 * processing engine's text heuristics are bypassed via contractHint: true.
 *
 * Response shape:
 *   { results: [ { jobId, employerName, jobTitle, locationName,
 *                  minimumSalary, maximumSalary, currency, date (DD/MM/YYYY),
 *                  jobDescription (truncated), jobUrl } ], totalResults }
 *
 * Notes:
 * - jobDescription in search results is truncated; UK contract ads usually
 *   put IR35 status in the title or opening line, so classification still
 *   catches most explicit mentions. Jobs without an explicit mention stay
 *   honestly "unknown".
 * - For contract roles Reed's min/max salary is typically the day rate;
 *   the rate parser's magnitude inference reads "£450 - £550" correctly.
 */

import { HttpClient } from "../ats/http-client";
import type { RawATSJob } from "../ats/types";

export interface ReedJob {
  jobId: number;
  employerName?: string;
  jobTitle?: string;
  locationName?: string;
  minimumSalary?: number | null;
  maximumSalary?: number | null;
  currency?: string | null;
  date?: string; // "DD/MM/YYYY"
  jobDescription?: string;
  jobUrl?: string;
}

interface ReedResponse {
  results: ReedJob[];
  totalResults?: number;
}

/** Convert Reed's DD/MM/YYYY into ISO 8601, or null if unparseable. */
export function reedDateToIso(date: string | undefined): string | null {
  if (!date) return null;
  const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T00:00:00Z`;
}

/** Build a parseable salary string from Reed's numeric fields. */
export function reedSalaryString(job: ReedJob): string {
  const min = job.minimumSalary;
  const max = job.maximumSalary;
  if (min == null && max == null) return "";
  const symbol = !job.currency || job.currency === "GBP" ? "£" : `${job.currency} `;
  if (min != null && max != null && min !== max) return `${symbol}${min} - ${symbol}${max}`;
  return `${symbol}${min ?? max}`;
}

export function mapReedJob(job: ReedJob): RawATSJob {
  return {
    sourceDomain: "reed.co.uk",
    sourceIdentifier: String(job.jobId),
    sourceType: "reed",
    title: job.jobTitle ?? "",
    companyName: job.employerName ?? "Unknown",
    description: job.jobDescription ?? "",
    location: job.locationName ?? "",
    rawSalary: reedSalaryString(job),
    applyUrl: job.jobUrl ?? `https://www.reed.co.uk/jobs/${job.jobId}`,
    postedAt: reedDateToIso(job.date),
    rawPayload: job,
    contractHint: true, // fetched with contract=true — definitively contract
    ukHint: true, // Reed is a UK job board — locations are UK by construction
  };
}

export interface ReedFetchOptions {
  apiKey: string;
  /** Number of 100-result pages to fetch (keep small: serverless time budget). */
  pages?: number;
}

export async function fetchReed(client: HttpClient, opts: ReedFetchOptions): Promise<RawATSJob[]> {
  const pages = opts.pages ?? 2;
  const auth = "Basic " + Buffer.from(`${opts.apiKey}:`).toString("base64");
  const jobs: RawATSJob[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < pages; page++) {
    const skip = page * 100;
    const url = `https://www.reed.co.uk/api/1.0/search?contract=true&resultsToTake=100&resultsToSkip=${skip}`;
    const data = await client.getJson<ReedResponse>(url, { headers: { authorization: auth } });
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const job of results) {
      const id = String(job.jobId);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapReedJob(job));
    }
    if (results.length < 100) break; // no more pages available
  }
  return jobs;
}
