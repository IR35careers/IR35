"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { IR35Badge } from "@/components/ui/ir35-badge";
import { JobCardSkeleton } from "@/components/ui/state-panel";
import { buttonClassName } from "@/components/ui/button";
import { formatPosted, formatRate, ir35EvidenceLabel, type JobListing } from "@/lib/job-types";

interface FeaturedResponse {
  jobs: JobListing[];
  total: number;
  data_source?: "live" | "demo";
  error?: string;
}

export function FeaturedJobs() {
  const [featured, setFeatured] = useState<JobListing[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [dataSource, setDataSource] = useState<"live" | "demo" | null>(null);
  const [jobsState, setJobsState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/jobs/search?per_page=4", { signal: controller.signal })
      .then(async (response) => {
        const json = (await response.json()) as FeaturedResponse;
        if (!response.ok || json.error) throw new Error(json.error ?? "Search unavailable");
        setFeatured(json.jobs);
        setTotal(json.total);
        setDataSource(json.data_source ?? "live");
        setJobsState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setJobsState("error");
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="relative min-w-0">
      <div className="rounded-[28px] border border-slate-200 bg-white/90 p-3 shadow-floating backdrop-blur sm:p-4">
        <div className="flex items-center justify-between gap-4 px-2 py-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Fresh contract opportunities</p>
            <p className="mt-1 text-sm font-medium text-slate-950" aria-live="polite">
              {total !== null ? `${total.toLocaleString()} active roles` : jobsState === "error" ? "Live search temporarily unavailable" : "Checking the latest roles…"}
            </p>
          </div>
          <Link href="/jobs" className="ir35-focus hidden min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 sm:inline-flex">
            View all <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>

        {dataSource === "demo" && (
          <p className="mx-2 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
            Preview data - connect Supabase to display live contracts locally.
          </p>
        )}

        <div className="space-y-2">
          {jobsState === "loading" && [0, 1, 2].map((item) => <JobCardSkeleton key={item} compact />)}
          {jobsState === "error" && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
              <p className="text-sm font-semibold text-slate-900">We couldn&apos;t load the preview.</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">You can still open contract search and try again.</p>
              <Link href="/jobs" className={buttonClassName({ variant: "secondary", size: "sm", className: "mt-4" })}>Open search</Link>
            </div>
          )}
          {jobsState === "ready" && featured.slice(0, 3).map((job) => (
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
