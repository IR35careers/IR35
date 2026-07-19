/**
 * Adzuna fetcher — UK jobs aggregator with an official public API.
 *
 * Signup: https://developer.adzuna.com (free, instant app_id + app_key).
 *
 * Endpoint:
 *   GET https://api.adzuna.com/v1/api/jobs/gb/search/{page}
 *     ?app_id=..&app_key=..&results_per_page=50&contract=1
 *     &category=it-jobs&sort_by=date
 *
 * `contract=1` scopes to contract roles (inside, outside, and unstated IR35 —
 * classification happens in the processing engine). `gb` scopes to the UK.
 *
 * Response: { results: [ { id, title, description (truncated), redirect_url,
 *   company: { display_name }, location: { display_name, area[] },
 *   salary_min, salary_max, salary_is_predicted ("0"|"1"),
 *   contract_type, contract_time, created (ISO) } ], count }
 *
 * Notes:
 * - salary_is_predicted "1" means Adzuna's ML estimated it (often wrongly
 *   annualised for day-rate roles) — we ignore predicted salaries and let
 *   the rate parser find real figures in the description instead.
 * - Descriptions are truncated (~500 chars); recruiters front-load
 *   "Outside IR35 £550/day", so detection still works for most ads.
 */

import { HttpClient } from "./http-client";
import type { RawATSJob } from "./types";

interface AdzunaJob {
  id: string | number;
  title?: string;
  description?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  salary_min?: number | null;
  salary_max?: number | null;
  salary_is_predicted?: string;
  contract_type?: string;
  created?: string;
}

interface AdzunaResponse {
  results: AdzunaJob[];
  count?: number;
}

export function mapAdzunaJob(job: AdzunaJob): RawATSJob {
  // Only trust salaries the advertiser actually posted.
  const predicted = job.salary_is_predicted === "1";
  const min = !predicted ? job.salary_min ?? null : null;
  const max = !predicted ? job.salary_max ?? null : null;
  const rawSalary = min !== null || max !== null ? `£${min ?? ""}-£${max ?? ""}` : "";

  const description = ["Employment type: Contract.", job.description ?? ""]
    .filter(Boolean)
    .join("\n\n");

  // area is like ["UK", "London", "Central London"] — append UK context so
  // the location normalizer's UK gate has what it needs.
  const display = job.location?.display_name ?? "";
  const areaHasUK = (job.location?.area ?? []).some((a) => /^uk$/i.test(a));
  const location = areaHasUK && !/\buk\b/i.test(display) ? `${display}, UK` : display;

  return {
    sourceDomain: "adzuna.co.uk",
    sourceIdentifier: String(job.id),
    sourceType: "adzuna",
    title: job.title ?? "",
    companyName: job.company?.display_name?.trim() || "Via Adzuna",
    description,
    location,
    rawSalary,
    applyUrl: job.redirect_url ?? "",
    postedAt: job.created ?? null,
    rawPayload: job,
  };
}

/**
 * Fetch recent UK contract roles from Adzuna (IT category), newest first.
 */
export async function fetchAdzuna(
  client: HttpClient,
  appId: string,
  appKey: string,
  pages = 3
): Promise<RawATSJob[]> {
  const jobs: RawATSJob[] = [];
  for (let page = 1; page <= pages; page++) {
    const url =
      `https://api.adzuna.com/v1/api/jobs/gb/search/${page}` +
      `?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}` +
      `&results_per_page=50&contract=1&category=it-jobs&sort_by=date`;
    const data = await client.getJson<AdzunaResponse>(url);
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const job of results) jobs.push(mapAdzunaJob(job));
    if (results.length < 50) break;
  }
  return jobs;
}
