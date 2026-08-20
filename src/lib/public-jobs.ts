import { DEMO_JOBS, isDemoDataAvailable } from "@/lib/demo-jobs";
import type { JobDetail, JobListing } from "@/lib/job-types";
import { supabase } from "@/lib/supabase";

export const JOB_DETAIL_COLUMNS =
  "id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at, last_seen_at, description, apply_url, source_domain";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasLiveDatabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** Read one active public listing. Invalid identifiers never reach Postgres. */
export async function getPublicJob(id: string): Promise<JobDetail | null> {
  if (!UUID_PATTERN.test(id)) return null;
  if (!hasLiveDatabase() && isDemoDataAvailable()) {
    return DEMO_JOBS.find((job) => job.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_DETAIL_COLUMNS)
    .eq("id", id)
    .is("expired_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as JobDetail;
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
