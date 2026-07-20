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
 *   5. EXPIRE   active jobs not seen by any source for 14 days
 *   6. LOG      one moderation_logs row per run with the full summary
 */

import { fetchAllCompanies, COMPANY_CONFIGS } from "../ats";
import { HttpClient } from "../ats/http-client";
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
  durationMs: number;
}

/** Stop starting new fetches once this much of the run has elapsed. */
const FETCH_TIME_BUDGET_MS = 42000;

const STALE_DAYS = 14;
const UPSERT_CHUNK = 100;

interface ExistingJob extends DedupCandidate {
  source_domain: string;
  source_identifier: string;
}

function normCompany(name: string): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function runFetchPipeline(
  configs: CompanyConfig[] = COMPANY_CONFIGS
): Promise<PipelineSummary> {
  const started = Date.now();
  const supabase = getSupabaseAdmin();

  // ── 1. Fetch: direct-employer ATS boards ───────────────────────────────
  const results = await fetchAllCompanies(configs);
  const companyErrors = results
    .filter((r) => r.error)
    .map((r) => ({ company: r.company.name, error: r.error as string }));
  const rawJobs: RawATSJob[] = results.flatMap((r) => r.jobs);
  const notes: string[] = [];

  // ── 1b. Fetch: job-board aggregators (the real contract volume) ────────
  // These use contract-only queries at the API level. Each is optional —
  // missing keys or an exhausted time budget produce a note, not a failure.
  const aggregatorClient = new HttpClient({ minDelayMs: 400 });
  const timeLeft = () => started + FETCH_TIME_BUDGET_MS - Date.now();

  const reedKey = process.env.REED_API_KEY;
  if (!reedKey) {
    notes.push("Reed skipped: REED_API_KEY not set (free key: reed.co.uk/developers/jobseeker)");
  } else if (timeLeft() < 8000) {
    notes.push("Reed skipped: fetch time budget exhausted");
  } else {
    try {
      const reedJobs = await fetchReed(aggregatorClient, { apiKey: reedKey, pages: 4 });
      // Fetch full descriptions (search API only returns a snippet). Newest
      // first, bounded so it never blows the serverless time budget.
      const enrichDeadline = Math.min(started + FETCH_TIME_BUDGET_MS, started + 38000);
      const enriched = await enrichReedDescriptions(aggregatorClient, reedKey, reedJobs, enrichDeadline);
      notes.push(`Reed: full descriptions fetched for ${enriched}/${reedJobs.length} jobs`);
      rawJobs.push(...reedJobs);
    } catch (err) {
      companyErrors.push({
        company: "Reed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const adzunaId = process.env.ADZUNA_APP_ID;
  const adzunaKey = process.env.ADZUNA_APP_KEY;
  if (!adzunaId || !adzunaKey) {
    notes.push("Adzuna skipped: ADZUNA_APP_ID / ADZUNA_APP_KEY not set (free: developer.adzuna.com)");
  } else if (timeLeft() < 8000) {
    notes.push("Adzuna skipped: fetch time budget exhausted");
  } else {
    try {
      const adzunaJobs = await fetchAdzuna(aggregatorClient, {
        appId: adzunaId,
        appKey: adzunaKey,
        pages: 2,
      });
      rawJobs.push(...adzunaJobs);
    } catch (err) {
      companyErrors.push({
        company: "Adzuna",
        error: err instanceof Error ? err.message : String(err),
      });
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
  let fuzzyDuplicatesSkipped = 0;

  for (const job of processed) {
    const companyKey = normCompany(job.company_name);
    const sameCompanyExisting = existingByCompany.get(companyKey) ?? [];

    // A fuzzy match only counts as a duplicate when it comes from a
    // DIFFERENT source posting — the same (source_domain, source_identifier)
    // is this very job re-fetched, which the upsert handles.
    const fuzzyMatch = findFuzzyDuplicate(job, sameCompanyExisting);
    const isCrossSourceDupe =
      fuzzyMatch !== null &&
      !(
        fuzzyMatch.source_domain === job.source_domain &&
        fuzzyMatch.source_identifier === job.source_identifier
      );

    // Also compare against jobs already accepted in THIS batch (different
    // source keys only).
    const batchMatch = findFuzzyDuplicate(
      job,
      accepted.filter(
        (a) =>
          normCompany(a.company_name) === companyKey &&
          !(a.source_domain === job.source_domain && a.source_identifier === job.source_identifier)
      )
    );

    if (isCrossSourceDupe || batchMatch) {
      fuzzyDuplicatesSkipped++;
      continue;
    }
    accepted.push(job);
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
