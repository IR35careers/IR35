/**
 * Adzuna fetcher — aggregated UK contract jobs from many boards.
 *
 * Endpoint: https://api.adzuna.com/v1/api/jobs/gb/search/{page}
 * Auth: app_id + app_key query params.
 * Get free credentials instantly at https://developer.adzuna.com
 *
 * We query with contract=1 so ONLY contract roles come back —
 * the processing engine's text heuristics are bypassed via contractHint.
 *
 * Response shape:
 *   { results: [ { id, title, description (truncated), redirect_url,
 *                  company: { display_name }, location: { display_name },
 *                  created (ISO), salary_min, salary_max,
 *                  salary_is_predicted ("0"|"1") } ], count }
 *
 * Note on salaries: Adzuna normalizes salary_min/max to ANNUAL figures even
 * for day-rate contracts, and often predicts them. Storing those as-is would
 * mislabel day rates, so we deliberately leave rawSalary empty and let the
 * rate parser find the real rate ("£550 per day") in the description text.
 */

import { HttpClient } from "../ats/http-client";
import type { RawATSJob } from "../ats/types";

export interface AdzunaJob {
  id: string | number;
  title?: string;
  description?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  created?: string; // ISO 8601
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
}

interface AdzunaResponse {
  results: AdzunaJob[];
  count?: number;
}

export function mapAdzunaJob(job: AdzunaJob): RawATSJob {
  return {
    sourceDomain: "adzuna.co.uk",
    sourceIdentifier: String(job.id),
    sourceType: "adzuna",
    title: job.title ?? "",
    companyName: job.company?.display_name ?? "Unknown",
    description: job.description ?? "",
    location: job.location?.display_name ?? "",
    rawSalary: "", // deliberately empty — see note in file header
    applyUrl: job.redirect_url ?? "",
    postedAt: job.created ?? null,
    rawPayload: job,
    contractHint: true, // fetched with contract=1
    ukHint: true, // /gb/ country endpoint is UK-only by construction
  };
}

export interface AdzunaFetchOptions {
  appId: string;
  appKey: string;
  /** Number of 50-result pages to fetch (keep small: serverless time budget). */
  pages?: number;
  /** High-value searches fetched in addition to the general contract pages. */
  keywordQueries?: string[];
}

export async function fetchAdzuna(
  client: HttpClient,
  opts: AdzunaFetchOptions
): Promise<RawATSJob[]> {
  const pages = opts.pages ?? 2;
  const jobs: RawATSJob[] = [];
  const seen = new Set<string>();

  const fetchPage = async (page: number, keywords?: string) => {
    const params = new URLSearchParams({
      app_id: opts.appId,
      app_key: opts.appKey,
      results_per_page: "50",
      contract: "1",
      sort_by: "date",
      "content-type": "application/json",
    });
    if (keywords) params.set("what", keywords);
    const url = `https://api.adzuna.com/v1/api/jobs/gb/search/${page}?${params.toString()}`;
    const data = await client.getJson<AdzunaResponse>(url);
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const job of results) {
      const id = String(job.id);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapAdzunaJob(job));
    }
    return results.length;
  };

  for (let page = 1; page <= pages; page++) {
    if ((await fetchPage(page)) < 50) break;
  }
  for (const keywords of opts.keywordQueries ?? []) {
    await fetchPage(1, keywords);
  }
  return jobs;
}
