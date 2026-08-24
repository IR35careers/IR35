import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApplicationStudio } from "@/components/workspace/ApplicationStudio";
import { HistoricalApplicationResolver } from "@/components/workspace/HistoricalApplicationResolver";
import { DEMO_JOBS, isDemoDataAvailable } from "@/lib/demo-jobs";
import type { JobDetail } from "@/lib/job-types";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prepare contract application", robots: { index: false, follow: false } };

const DETAIL_COLUMNS = "id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at, description, apply_url, source_domain";

async function getJob(id: string): Promise<JobDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!configured && isDemoDataAvailable()) return DEMO_JOBS.find((job) => job.id === id) ?? null;
  const { data, error } = await supabase.from("jobs").select(DETAIL_COLUMNS).eq("id", id).is("expired_at", null).maybeSingle();
  if (error || !data) return null;
  return data as unknown as JobDetail;
}

export default async function PrepareApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ applicationId?: string | string[] }>;
}) {
  const { jobId } = await params;
  const query = await searchParams;
  const applicationId = Array.isArray(query.applicationId) ? query.applicationId[0] : query.applicationId;
  const job = await getJob(jobId);
  if (!job && applicationId && /^[0-9a-z-]{8,80}$/i.test(applicationId)) {
    return <HistoricalApplicationResolver applicationId={applicationId} jobId={jobId} />;
  }
  if (!job) notFound();
  return <ApplicationStudio job={job} />;
}
