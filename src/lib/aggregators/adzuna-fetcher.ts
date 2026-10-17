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

import { HttpClient, HttpError } from "../ats/http-client";
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
  keywordPages?: number;
  deadlineMs?: number;
  /** Adzuna's official freshness filter; old adverts are not fresh inventory. */
  maxDaysOld?: number;
  onPageError?: (query: string, page: number, message: string) => void;
}

export async function fetchAdzuna(
  client: HttpClient,
  opts: AdzunaFetchOptions
): Promise<RawATSJob[]> {
  const pages = Math.max(1, Math.min(10, opts.pages ?? 2));
  const keywordPages = Math.max(1, Math.min(5, opts.keywordPages ?? 1));
  const deadline = opts.deadlineMs ?? Number.POSITIVE_INFINITY;
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
    if (opts.maxDaysOld) params.set("max_days_old", String(Math.max(1, Math.min(90, opts.maxDaysOld))));
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

  let completedPages = 0;
  let lastError = "";
  const queries = [undefined, ...new Set(opts.keywordQueries ?? [])];
  for (const keywords of queries) {
    const pageCount = keywords === undefined ? pages : keywordPages;
    for (let page = 1; page <= pageCount; page++) {
      if (Date.now() >= deadline) return jobs;
      try {
        const count = await fetchPage(page, keywords);
        completedPages++;
        if (count < 50) break;
      } catch (error) {
        // HttpError.url contains app_key; keep credentials out of diagnostics.
        lastError = error instanceof HttpError ? `HTTP ${error.status}` : "request failed or timed out";
        opts.onPageError?.(keywords ?? "All UK contracts", page, lastError);
        break;
      }
    }
  }
  if (completedPages === 0 && lastError) throw new Error(`Adzuna searches failed: ${lastError}`);
  return jobs;
}
