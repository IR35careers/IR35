/**
 * ATS Orchestrator + Company Registry.
 *
 * fetchAllCompanies() runs every configured company through the right
 * fetcher, isolating failures — one company 404ing (wrong slug, board moved)
 * never sinks the run; it's reported in that company's FetchResult.error.
 *
 * ── Adding a company ─────────────────────────────────────────────────────
 * Append one line to COMPANY_CONFIGS. The slug is the identifier in the
 * company's public job-board URL:
 *   Greenhouse: boards.greenhouse.io/{slug} or job-boards.greenhouse.io/{slug}
 *   Lever:      jobs.lever.co/{slug}
 *   Ashby:      jobs.ashbyhq.com/{slug}
 *   Workable:   apply.workable.com/{slug}
 *
 * A wrong slug shows up as a clear per-company error in the pipeline
 * summary — cheap to add, cheap to fix.
 *
 * ── Expectations ─────────────────────────────────────────────────────────
 * These are direct employers' boards, which skew permanent — the processing
 * engine drops non-contract roles, so per-company contract yield will be
 * low at first. That's fine: this proves the pipeline end to end. Volume
 * comes from adding many companies (cheap) and, per the launch plan, from
 * recruitment-agency partnerships whose feeds are contract-heavy.
 *
 * NOTE: Personio (from the original blueprint) is deferred — its public feed
 * is XML, UK contract inventory there is minimal, and shipping an untested
 * XML parser isn't worth the risk yet.
 */

import { HttpClient } from "./http-client";
import { fetchGreenhouse } from "./greenhouse-fetcher";
import { fetchLever } from "./lever-fetcher";
import { fetchAshby } from "./ashby-fetcher";
import { fetchWorkable } from "./workable-fetcher";
import type { CompanyConfig, FetchResult } from "./types";

/**
 * Starter registry: well-known UK tech companies with public boards on the
 * supported ATSes. Slugs follow each company's public careers URL but SHOULD
 * BE VERIFIED on first run — the pipeline summary flags any that 404.
 */
export const COMPANY_CONFIGS: CompanyConfig[] = [
  // Greenhouse (verified working)
  { name: "Monzo", type: "greenhouse", slug: "monzo" },
  { name: "GoCardless", type: "greenhouse", slug: "gocardless" },
  { name: "Trustpilot", type: "greenhouse", slug: "trustpilot" },
  { name: "Form3", type: "greenhouse", slug: "form3" },
  { name: "TwinStream", type: "greenhouse", slug: "twinstream" },
  { name: "Adaptive Financial Consulting", type: "greenhouse", slug: "adaptivefinancialconsulting" },
  { name: "PlayStation Global", type: "greenhouse", slug: "sonyinteractiveentertainmentglobal" },
  { name: "Liquid Personnel", type: "greenhouse", slug: "liquidpersonnel" },
  { name: "Capco", type: "greenhouse", slug: "capco" },
  { name: "WongDoody", type: "greenhouse", slug: "wongdoody" },

  // Lever (verified working)
  { name: "Octopus Energy", type: "lever", slug: "octoenergy" },

  // Ashby (verified working)
  { name: "Multiverse", type: "ashby", slug: "multiverse" },
  { name: "Synthesia", type: "ashby", slug: "synthesia" },
  { name: "Deliveroo", type: "ashby", slug: "deliveroo" },

  // Workable (verified working)
  { name: "Blockchain.com", type: "workable", slug: "blockchain" },
  { name: "Starling Bank", type: "workable", slug: "starling" },
  { name: "Focus Group", type: "workable", slug: "focus-group" },
  { name: "OnBuy", type: "workable", slug: "onbuy" },
  { name: "Safran Engineering Services UK", type: "workable", slug: "safrangroup" },
];

const FETCHERS = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
} as const;

export async function fetchCompany(client: HttpClient, company: CompanyConfig): Promise<FetchResult> {
  const fetcher = FETCHERS[company.type as keyof typeof FETCHERS];
  if (!fetcher) {
    return { company, jobs: [], error: `Unsupported ATS type: ${company.type}` };
  }
  try {
    const jobs = await fetcher(client, company);
    return { company, jobs, error: null };
  } catch (err) {
    return { company, jobs: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchAllCompanies(
  configs: CompanyConfig[] = COMPANY_CONFIGS,
  clientOrFactory: HttpClient | (() => HttpClient) = new HttpClient(),
  concurrency = 1,
  deadlineMs = Number.POSITIVE_INFINITY
): Promise<FetchResult[]> {
  // De-duplicate registry entries defensively (same type+slug listed twice).
  const seen = new Set<string>();
  const unique = configs.filter((c) => {
    const key = `${c.type}:${c.slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const results: FetchResult[] = new Array(unique.length);
  const workerCount = typeof clientOrFactory === "function"
    ? Math.max(1, Math.min(Math.floor(concurrency), unique.length || 1))
    : 1;
  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const index = cursor;
      cursor += 1;
      const company = unique[index];
      if (Date.now() >= deadlineMs) {
        results[index] = { company, jobs: [], error: "Skipped because the daily source time budget was reached" };
        continue;
      }
      const client = typeof clientOrFactory === "function" ? clientOrFactory() : clientOrFactory;
      results[index] = await fetchCompany(client, company);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
