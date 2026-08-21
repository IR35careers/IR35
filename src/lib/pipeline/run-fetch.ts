/**
 * Pipeline runner: the daily job that keeps the board fresh.
 *
 *   1. FETCH    all companies in the registry (rate-limited, per-company
 *               error isolation)
 *   2. PROCESS  every raw job through the Phase 1 engine (contract gate,
 *               UK gate, rates, IR35, skills) — nulls are skipped
 *   3. DEDUP    Tier 1 is the DB unique constraint (upsert). Tier 2 fuzzy:
 *               compare candidates against existing active jobs *from other
 *               sources* at the same company, and against each other
 *   4. UPSERT   in chunks; reappearing jobs get last_seen_at refreshed and
 *               expired_at cleared
 *   5. EXPIRE   active jobs not seen by any source for 10 days
 *   6. LOG      one moderation_logs row per run with the full summary
 */

import { fetchAllCompanies } from "../ats";
import { HttpClient } from "../ats/http-client";
import { loadEnabledCompanyConfigs } from "../ats/source-registry";
import type { CompanyConfig, ProcessedJob, RawATSJob } from "../ats/types";
import { fetchReed, enrichReedDescriptions } from "../aggregators/reed-fetcher";
import { fetchAdzuna } from "../aggregators/adzuna-fetcher";
import { processRawJob } from "../processing/job-processor";
import { findFuzzyDuplicate, type DedupCandidate } from "../processing/deduplicator";
import { getSupabaseAdmin } from "../supabase-admin";

export interface PipelineSummary {
  companies: number;
  fetched: number;
  processed: number;
  skippedByGates: number;
  fuzzyDuplicatesSkipped: number;
  upserted: number;
  expired: number;
  companyErrors: Array<{ company: string; error: string }>;
  /** Jobs stored per source domain, e.g. { "reed.co.uk": 180, ... } */
  bySource: Record<string, number>;
  /** Operational notes: skipped sources, missing keys, time-budget cuts. */
  notes: string[];
  /** Per-provider diagnostics so source failures are visible without log archaeology. */
  sourceRuns: SourceRunSummary[];
  durationMs: number;
}

export interface SourceRunSummary {
  source: string;
  status: "success" | "skipped" | "error";
  fetched: number;
  durationMs: number;
  detailEnriched?: number;
  message?: string;
}

/** Leave headroom inside Vercel's 60-second function limit for DB writes. */
const FETCH_TIME_BUDGET_MS = 48000;
const REED_ENRICHMENT_BUDGET_MS = 8000;

const STALE_DAYS = 10;
const UPSERT_CHUNK = 100;

interface ExistingJob extends DedupCandidate {
  source_domain: string;
  source_identifier: string;
}

function normCompany(name: string): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function runFetchPipeline(
  configuredSources?: CompanyConfig[]
): Promise<PipelineSummary> {
  const started = Date.now();
  const supabase = getSupabaseAdmin();
  const configs = configuredSources ?? await loadEnabledCompanyConfigs(supabase);
  const notes: string[] = [];
  const companyErrors: Array<{ company: string; error: string }> = [];
  const sourceRuns: SourceRunSummary[] = [];

  // ── 1. Fetch every provider independently ──────────────────────────────
  // A slow ATS or Reed detail request must never prevent Adzuna from being
  // attempted. Each provider gets its own rate limiter and failure boundary.
  const reedKey = process.env.REED_API_KEY;
  const adzunaId = process.env.ADZUNA_APP_ID;
  const adzunaKey = process.env.ADZUNA_APP_KEY;

  const directTask = (async () => {
    const sourceStarted = Date.now();
    try {
      const results = await fetchAllCompanies(
        configs,
        () => new HttpClient({
          minDelayMs: 0,
          timeoutMs: 4000,
          maxRetries: 0,
        }),
        10,
        started + 40_000
      );
      return {
        results,
        jobs: results.flatMap((result) => result.jobs),
        run: {
          source: "Direct employer ATS",
          status: "success" as const,
          fetched: results.reduce((count, result) => count + result.jobs.length, 0),
          durationMs: Date.now() - sourceStarted,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        results: [],
        jobs: [] as RawATSJob[],
        run: {
          source: "Direct employer ATS",
          status: "error" as const,
          fetched: 0,
          durationMs: Date.now() - sourceStarted,
          message,
        },
      };
    }
  })();

  const reedTask = (async () => {
    const sourceStarted = Date.now();
    if (!reedKey) {
      return {
        jobs: [] as RawATSJob[],
        run: {
          source: "Reed",
          status: "skipped" as const,
          fetched: 0,
          durationMs: 0,
          message: "REED_API_KEY is not configured",
        },
      };
    }
    try {
      const client = new HttpClient({
        minDelayMs: 300,
        timeoutMs: 8000,
        maxRetries: 1,
        baseBackoffMs: 500,
      });
      const jobs = await fetchReed(client, {
        apiKey: reedKey,
        pages: 4,
        keywordQueries: ["outside IR35", "inside IR35", "IR35 contract"],
      });
      return {
        jobs,
        run: {
          source: "Reed",
          status: "success" as const,
          fetched: jobs.length,
          durationMs: Date.now() - sourceStarted,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        jobs: [] as RawATSJob[],
        run: {
          source: "Reed",
          status: "error" as const,
          fetched: 0,
          durationMs: Date.now() - sourceStarted,
          message,
        },
      };
    }
  })();

  const adzunaTask = (async () => {
    const sourceStarted = Date.now();
    if (!adzunaId || !adzunaKey) {
      return {
        jobs: [] as RawATSJob[],
        run: {
          source: "Adzuna",
          status: "skipped" as const,
          fetched: 0,
          durationMs: 0,
          message: "ADZUNA_APP_ID or ADZUNA_APP_KEY is not configured",
        },
      };
    }
    try {
      const client = new HttpClient({
        minDelayMs: 300,
        timeoutMs: 8000,
        maxRetries: 1,
        baseBackoffMs: 500,
      });
      const jobs = await fetchAdzuna(client, {
        appId: adzunaId,
        appKey: adzunaKey,
        pages: 3,
        keywordQueries: ["outside IR35", "inside IR35"],
      });
      return {
        jobs,
        run: {
          source: "Adzuna",
          status: "success" as const,
          fetched: jobs.length,
          durationMs: Date.now() - sourceStarted,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        jobs: [] as RawATSJob[],
        run: {
          source: "Adzuna",
          status: "error" as const,
          fetched: 0,
          durationMs: Date.now() - sourceStarted,
          message,
        },
      };
    }
  })();

  const [direct, reed, adzuna] = await Promise.all([directTask, reedTask, adzunaTask]);
  const results = direct.results;
  const rawJobs: RawATSJob[] = [...direct.jobs, ...reed.jobs, ...adzuna.jobs];
  sourceRuns.push(direct.run, reed.run, adzuna.run);

  for (const result of results) {
    if (result.error) companyErrors.push({ company: result.company.name, error: result.error });
  }
  for (const run of sourceRuns) {
    if (run.status === "skipped" && run.message) notes.push(`${run.source} skipped: ${run.message}`);
    if (run.status === "error" && run.message) companyErrors.push({ company: run.source, error: run.message });
  }

  // Reed's search endpoint returns a snippet. Enrich only after every base
  // provider has had its turn, and stop early to preserve DB-write headroom.
  if (reedKey && reed.jobs.length > 0) {
    const remainingMs = started + FETCH_TIME_BUDGET_MS - Date.now();
    if (remainingMs > 1500) {
      const enrichmentStarted = Date.now();
      const enrichmentClient = new HttpClient({
        minDelayMs: 150,
        timeoutMs: 5000,
        maxRetries: 0,
      });
      const enrichDeadline = Math.min(
        started + FETCH_TIME_BUDGET_MS,
        enrichmentStarted + REED_ENRICHMENT_BUDGET_MS
      );
      const enriched = await enrichReedDescriptions(
        enrichmentClient,
        reedKey,
        reed.jobs,
        enrichDeadline
      );
      const reedRun = sourceRuns.find((run) => run.source === "Reed");
      if (reedRun) {
        reedRun.detailEnriched = enriched;
        reedRun.durationMs += Date.now() - enrichmentStarted;
      }
      notes.push(`Reed: full descriptions fetched for ${enriched}/${reed.jobs.length} jobs`);
    } else {
      notes.push("Reed detail enrichment skipped: DB-write safety window reached");
    }
  }

  // ── 2. Process ─────────────────────────────────────────────────────────
  const processed: ProcessedJob[] = [];
  for (const raw of rawJobs) {
    const job = processRawJob(raw);
    if (job) processed.push(job);
  }
  const skippedByGates = rawJobs.length - processed.length;

  // ── 3. Fuzzy dedup (Tier 2) ────────────────────────────────────────────
  const { data: existingData, error: existingError } = await supabase
    .from("jobs")
    .select("title, company_name, rate_min, rate_max, location, source_domain, source_identifier")
    .is("expired_at", null)
    .limit(10000);
  if (existingError) throw new Error(`Failed to load existing jobs: ${existingError.message}`);

  const existingByCompany = new Map<string, ExistingJob[]>();
  for (const row of (existingData ?? []) as ExistingJob[]) {
    const key = normCompany(row.company_name);
    const list = existingByCompany.get(key) ?? [];
    list.push(row);
    existingByCompany.set(key, list);
  }

  const accepted: ProcessedJob[] = [];
  const acceptedByCompany = new Map<string, ProcessedJob[]>();
  let fuzzyDuplicatesSkipped = 0;

  for (const job of processed) {
    const companyKey = normCompany(job.company_name);
    const sameCompanyExisting = existingByCompany.get(companyKey) ?? [];

    // A fuzzy match only counts as a duplicate when it comes from a
    // DIFFERENT source posting — the same (source_domain, source_identifier)
    // is this very job re-fetched, which the upsert handles.
    // Filter the exact source row before matching. Otherwise it may be the
    // first fuzzy result and hide a later duplicate from another provider.
    const crossSourceExisting = sameCompanyExisting.filter(
      (candidate) =>
        !(candidate.source_domain === job.source_domain &&
          candidate.source_identifier === job.source_identifier)
    );
    const fuzzyMatch = findFuzzyDuplicate(job, crossSourceExisting);
    const isCrossSourceDupe = fuzzyMatch !== null;

    // Also compare against jobs already accepted in THIS batch (different
    // source keys only).
    const sameCompanyAccepted = acceptedByCompany.get(companyKey) ?? [];
    const batchMatch = findFuzzyDuplicate(
      job,
      sameCompanyAccepted.filter(
        (a) => !(a.source_domain === job.source_domain && a.source_identifier === job.source_identifier)
      )
    );

    if (isCrossSourceDupe || batchMatch) {
      fuzzyDuplicatesSkipped++;
      continue;
    }
    accepted.push(job);
    sameCompanyAccepted.push(job);
    acceptedByCompany.set(companyKey, sameCompanyAccepted);
  }

  // ── 4. Upsert ──────────────────────────────────────────────────────────
  const nowIso = new Date().toISOString();
  let upserted = 0;
  for (let i = 0; i < accepted.length; i += UPSERT_CHUNK) {
    const chunk = accepted.slice(i, i + UPSERT_CHUNK).map((job) => ({
      ...job,
      last_seen_at: nowIso,
      expired_at: null, // a job seen in a live feed is active by definition
    }));
    const { error } = await supabase
      .from("jobs")
      .upsert(chunk, { onConflict: "source_domain,source_identifier" });
    if (error) throw new Error(`Upsert failed (chunk ${i / UPSERT_CHUNK}): ${error.message}`);
    upserted += chunk.length;
  }

  // ── 5. Expire stale ────────────────────────────────────────────────────
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: expiredRows, error: expireError } = await supabase
    .from("jobs")
    .update({ expired_at: nowIso })
    .is("expired_at", null)
    .lt("last_seen_at", cutoff)
    .select("id");
  if (expireError) throw new Error(`Expiry failed: ${expireError.message}`);
  const expired = expiredRows?.length ?? 0;

  // ── 6. Log ─────────────────────────────────────────────────────────────
  const bySource: Record<string, number> = {};
  for (const job of accepted) {
    bySource[job.source_domain] = (bySource[job.source_domain] ?? 0) + 1;
  }

  const summary: PipelineSummary = {
    companies: results.length,
    fetched: rawJobs.length,
    processed: processed.length,
    skippedByGates,
    fuzzyDuplicatesSkipped,
    upserted,
    expired,
    companyErrors,
    bySource,
    notes,
    sourceRuns,
    durationMs: Date.now() - started,
  };

  const { error: logError } = await supabase
    .from("moderation_logs")
    .insert({ run_type: "fetch_jobs", summary });
  if (logError) {
    // Logging failure shouldn't fail the run — surface it in the summary.
    summary.companyErrors.push({ company: "_logging", error: logError.message });
  }

  return summary;
}
