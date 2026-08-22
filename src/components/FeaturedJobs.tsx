import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { IR35Badge } from "@/components/ui/ir35-badge";
import { buttonClassName } from "@/components/ui/button";
import { DEMO_JOBS, isDemoDataAvailable } from "@/lib/demo-jobs";
import { formatPosted, formatRate, ir35EvidenceLabel, JOB_LIST_COLUMNS, type JobListing } from "@/lib/job-types";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { supabase } from "@/lib/supabase";

interface FeaturedResult {
  jobs: JobListing[];
  total: number;
  dataSource: "live" | "demo";
  error: boolean;
}

async function loadFeaturedJobs(): Promise<FeaturedResult> {
  if (!isSupabaseConfigured() && isDemoDataAvailable()) {
    return { jobs: DEMO_JOBS.slice(0, 3), total: DEMO_JOBS.length, dataSource: "demo", error: false };
  }

  try {
    const { data, error, count } = await supabase
      .from("jobs")
      .select(JOB_LIST_COLUMNS, { count: "exact" })
      .is("expired_at", null)
      .order("posted_on", { ascending: false, nullsFirst: false })
      .order("posted_at", { ascending: false, nullsFirst: false })
      .order("rate_max", { ascending: false, nullsFirst: false })
      .limit(3);
    if (error) throw error;
    return { jobs: (data ?? []) as JobListing[], total: count ?? 0, dataSource: "live", error: false };
  } catch {
    return { jobs: [], total: 0, dataSource: "live", error: true };
  }
}

export async function FeaturedJobs() {
  const featured = await loadFeaturedJobs();

  return (
    <div className="relative min-w-0">
      <div className="rounded-[28px] border border-slate-200 bg-white/90 p-3 shadow-floating backdrop-blur sm:p-4">
        <div className="flex items-center justify-between gap-4 px-2 py-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Fresh contract opportunities</p>
            <p className="mt-1 text-sm font-medium text-slate-950">
              {featured.error ? "Live search temporarily unavailable" : `${featured.total.toLocaleString()} active roles`}
            </p>
          </div>
          <Link href="/jobs" className="ir35-focus hidden min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 sm:inline-flex">
            View all <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>

        {featured.dataSource === "demo" && (
          <p className="mx-2 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
            Preview roles are shown in this local workspace.
          </p>
        )}

        <div className="space-y-2">
          {featured.error && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
              <p className="text-sm font-semibold text-slate-900">We couldn&apos;t load the preview.</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">You can still open contract search and try again.</p>
              <Link href="/jobs" className={buttonClassName({ variant: "secondary", size: "sm", className: "mt-4" })}>Open search</Link>
            </div>
          )}
          {!featured.error && featured.jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="ir35-focus group block rounded-2xl border border-slate-200 bg-white p-4 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-slate-950">{job.title}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{job.company_name} · {job.location}</p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-slate-950">{formatRate(job)}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <IR35Badge status={job.ir35_status} size="xs" />
                <span className="text-[11px] text-slate-500">{ir35EvidenceLabel(job)} · {formatPosted(job)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
