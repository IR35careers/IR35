import { DEMO_JOBS, isDemoDataAvailable } from "@/lib/demo-jobs";
import type { JobDetail, JobListing } from "@/lib/job-types";
import { supabase } from "@/lib/supabase";
import { cache } from "react";
import { isTruncatedJobDescription } from "@/lib/job-seo";
import { fetchReedDetail } from "@/lib/aggregators/reed-fetcher";
import { HttpClient } from "@/lib/ats/http-client";
import { stripHtml } from "@/lib/processing/job-processor";

export const JOB_DETAIL_COLUMNS =
  "id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at, last_seen_at, description, apply_url, source_domain";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasLiveDatabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const readActiveJob = cache(async (id: string): Promise<JobDetail | null> => {
  const { data, error } = await supabase
    .from("jobs")
    .select(`${JOB_DETAIL_COLUMNS},source_identifier`)
    .eq("id", id)
    .is("expired_at", null)
    .maybeSingle();

  if (error) throw new Error("Contract details are temporarily unavailable");
  if (!data) return null;
  const job = data as unknown as JobDetail;
  // The official per-job endpoint supplies full text unlike Reed search.
  // Its host is fixed, identifiers are numeric and secrets stay server-side.
  // Bound cold-read latency; cached reads do not repeat the provider request.
  if (isTruncatedJobDescription(job.description) && job.source_domain === "reed.co.uk"
    && process.env.REED_API_KEY && /^\d+$/.test(data.source_identifier ?? "")) {
    const full = await fetchReedDetail(new HttpClient({ timeoutMs: 2500, maxRetries: 0, minDelayMs: 0 }), process.env.REED_API_KEY, data.source_identifier);
    const text = full ? stripHtml(full) : "";
    if (text.length > job.description.length && !isTruncatedJobDescription(text)) job.description = text;
  }
  return job;
});

/** Read one active public listing. Invalid identifiers never reach Postgres. */
export async function getPublicJob(id: string): Promise<JobDetail | null> {
  if (!UUID_PATTERN.test(id)) return null;
  if (!hasLiveDatabase() && isDemoDataAvailable()) {
    return DEMO_JOBS.find((job) => job.id === id) ?? null;
  }
  return readActiveJob(id);
}

/** Related active contracts for the public detail experience. */
export async function getSimilarPublicJobs(job: JobDetail): Promise<JobListing[]> {
  if (!hasLiveDatabase() && isDemoDataAvailable()) {
    return DEMO_JOBS.filter(
      (candidate) =>
        candidate.id !== job.id &&
        candidate.skills.some((skill) => job.skills.includes(skill))
    ).slice(0, 6);
  }

  let query = supabase
    .from("jobs")
    .select("id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at, last_seen_at")
    .is("expired_at", null)
    .neq("id", job.id)
    .limit(6);
  if (job.skills.length > 0) query = query.overlaps("skills", job.skills.slice(0, 8));
  const { data } = await query;
  return (data ?? []) as unknown as JobListing[];
}
