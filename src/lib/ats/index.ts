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
 *   SmartRecruiters: jobs.smartrecruiters.com/{slug}
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
import { fetchSmartRecruiters } from "./smartrecruiters-fetcher";
import type { CompanyConfig, FetchResult, RawATSJob } from "./types";

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
  { name: "Pulse Healthcare", type: "greenhouse", slug: "pulse" },

  // Lever (verified working)
  { name: "Octopus Energy", type: "lever", slug: "octoenergy" },
  { name: "SQA Services", type: "lever", slug: "sqaservices" },
  { name: "Sofar Sounds", type: "lever", slug: "sofarsounds" },
  { name: "Contentsquare", type: "lever", slug: "contentsquare" },

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
  { name: "Mindera", type: "workable", slug: "minderacraft" },
  { name: "Sword Group", type: "workable", slug: "sword-group" },
  // Verified public boards with live UK contract engagements. Retain the
  // advertiser's IR35 evidence; contract employment alone never means outside.
  { name: "AND Digital", type: "workable", slug: "and-digital" },
  { name: "e-ppl", type: "workable", slug: "epplautoscan" },
  { name: "People Puzzles", type: "workable", slug: "people-puzzles-ltd" },
  { name: "Indra Group UK & Ireland", type: "workable", slug: "indra-uk" },
  { name: "Peopleworth", type: "workable", slug: "peopleworth" },
  { name: "Second Nature", type: "workable", slug: "secondnature" },
  { name: "Worldwide Events Group", type: "workable", slug: "mi-forums" },

  // SmartRecruiters official public Posting API
  { name: "General Dynamics Mission Systems", type: "smartrecruiters", slug: "gdmsi" },
  { name: "Telefonica Tech", type: "smartrecruiters", slug: "telefonicatech" },
  { name: "Scalian", type: "smartrecruiters", slug: "scalian" },
  { name: "Version 1", type: "smartrecruiters", slug: "version1" },
  { name: "Jobs for Humanity", type: "smartrecruiters", slug: "jobsforhumanity" },
];

const FETCHERS: Partial<Record<CompanyConfig["type"], (
  client: HttpClient, company: CompanyConfig, deadlineMs?: number
) => Promise<RawATSJob[]>>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
  smartrecruiters: fetchSmartRecruiters,
} as const;

export async function fetchCompany(client: HttpClient, company: CompanyConfig, deadlineMs?: number): Promise<FetchResult> {
  const fetcher = FETCHERS[company.type as keyof typeof FETCHERS];
  if (!fetcher) {
    return { company, jobs: [], error: `Unsupported ATS type: ${company.type}` };
  }
  try {
    const jobs = await fetcher(client, company, deadlineMs);
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
      results[index] = await fetchCompany(client, company, deadlineMs);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
