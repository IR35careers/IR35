import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { ResumeStudio } from "@/components/resume/ResumeStudio";
import type { JobDetail } from "@/lib/job-types";
import { DEMO_JOBS, isDemoDataAvailable } from "@/lib/demo-jobs";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tailor your Resume to a contract",
  description: "Score, review, improve and export your Resume for a role without inventing experience.",
  robots: { index: false, follow: false },
};

const DETAIL_COLUMNS =
  "id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at, description, apply_url, source_domain";

async function getJob(id: string): Promise<JobDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!configured && isDemoDataAvailable()) return DEMO_JOBS.find((job) => job.id === id) ?? null;
  const { data, error } = await supabase.from("jobs").select(DETAIL_COLUMNS).eq("id", id).is("expired_at", null).maybeSingle();
  if (error || !data) return null;
  return data as unknown as JobDetail;
}

export default async function ResumeStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  return (
    <div className="min-h-screen bg-slate-50">
      <PublicHeader />
      <ResumeStudio job={job} />
      <PublicFooter />
    </div>
  );
}
