import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, ArrowUpRight, MapPin, Clock, PoundSterling, Briefcase, WandSparkles } from "lucide-react";
import { ApplyButton } from "@/components/ApplyButton";
import { IR35EvidencePanel } from "@/components/IR35EvidencePanel";
import { SaveJobButton } from "@/components/SaveJobButton";
import { JobMatchPanel } from "@/components/JobMatchPanel";
import { PublicHeader } from "@/components/PublicHeader";
import { WorkspaceAwareFooter } from "@/components/WorkspaceAwareFooter";
import { IR35Badge } from "@/components/ui/ir35-badge";
import { formatPosted, formatRate, type JobDetail, type JobListing } from "@/lib/job-types";
import { getPublicJob, getSimilarPublicJobs } from "@/lib/public-jobs";

// The per-request CSP nonce must also be applied to the streamed RSC scripts.
// Static prerendering cannot know that nonce and leaves live contract pages on
// the loading fallback in browsers that correctly enforce the CSP.
export const dynamic = "force-dynamic";

const getJob = cache((id: string): Promise<JobDetail | null> => getPublicJob(id));

/** Live "similar contracts": same skills, not this job, newest first. */
async function getSimilar(job: JobDetail): Promise<JobListing[]> {
  return getSimilarPublicJobs(job);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return { title: "Contract not found", robots: { index: false, follow: false } };
  const status =
    job.ir35_status === "outside" ? "Outside IR35" : job.ir35_status === "inside" ? "Inside IR35" : "";
  const title = `${job.title} at ${job.company_name}${status ? ` (${status})` : ""}`;
  const description = `${formatRate(job)} · ${job.location}. Review this UK contract role on IR35Careers.`;
  const url = `/jobs/${job.id}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
  };
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  const similar = await getSimilar(job);
  const isDemo = job.source_domain === "demo.ir35careers.local";
  const remoteLabel =
    job.remote_type === "remote"
      ? "Remote"
      : job.remote_type === "hybrid"
        ? "Hybrid"
        : job.remote_type === "onsite"
          ? "On-site"
          : null;

  const factCards = [
    { icon: PoundSterling, label: job.rate_type === "annual" ? "Salary" : job.rate_type === "hourly" ? "Hourly rate" : "Day rate", value: formatRate(job) },
    { icon: MapPin, label: "Location", value: job.location || "N/A" },
    { icon: Briefcase, label: "Workplace", value: remoteLabel ?? "N/A" },
    { icon: Clock, label: "Posted", value: formatPosted(job) },
  ];

  return (
    <div className="min-h-screen bg-[#f7f8f7] text-slate-900">
      <PublicHeader hideForWorkspaceMembers />

      <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 sm:py-9">
        <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-slate-600 transition-colors hover:text-slate-900">
          <ArrowLeft size={14} /> Back to contracts
        </Link>

        {/* Title row */}
        <header className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="max-w-4xl text-3xl font-bold tracking-[-0.04em] text-slate-950 sm:text-[42px] sm:leading-[1.08]">{job.title}</h1>
            <p className="mt-2 text-base font-medium text-slate-600">{job.company_name}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <IR35Badge status={job.ir35_status} />
              {remoteLabel && (
                <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600">
                  {remoteLabel}
                </span>
              )}
            </div>
          </div>
          <div className="grid shrink-0 gap-2 sm:grid-cols-3 lg:min-w-[440px]">
            <ApplyButton jobId={job.id} sourceDomain={job.source_domain} />
            <Link
              href={`/jobs/${job.id}/resume`}
              className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white shadow-[0_16px_35px_-20px_rgba(5,150,105,0.75)] hover:bg-brand-800"
            >
              <WandSparkles size={16} aria-hidden="true" /> Prepare application
            </Link>
            <SaveJobButton jobId={job.id} />
          </div>
        </header>

        {isDemo && (
          <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            This preview listing is available only in the local workspace.
          </p>
        )}

        {/* Fact cards */}
        <div className="mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {factCards.map((f) => (
            <div key={f.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.45)]">
              <f.icon size={16} className="text-green-600" />
              <p className="mt-2 break-words text-base font-semibold tabular-nums text-slate-900 sm:text-lg">{f.value}</p>
              <p className="text-xs uppercase tracking-wide text-slate-600">{f.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_350px]">
          {/* Main content */}
          <div className="min-w-0">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.45)] sm:p-7">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Role description</h2>
              <div className="mt-4 whitespace-pre-line text-[15px] leading-7 text-slate-700">
                {job.description || "Full details are on the original listing."}
              </div>
              {job.skills.length > 0 && (
                <div className="mt-7 border-t border-slate-200 pt-6">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Skills in this listing</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                  {job.skills.map((skill) => (
                    <span key={skill} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                      {skill}
                    </span>
                  ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="space-y-4 lg:sticky lg:top-24 lg:h-max">
            <JobMatchPanel job={job} showTailorAction={false} />
            <IR35EvidencePanel job={job} compact />
          </div>
        </div>

        {similar.length > 0 && (
          <section className="mt-8 border-t border-slate-200 pt-7">
            <div className="flex items-end justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Keep exploring</p><h2 className="mt-1 text-xl font-bold text-slate-950">Similar contracts</h2></div>
              <Link href="/jobs" className="ir35-focus inline-flex min-h-10 items-center gap-1 text-sm font-bold text-brand-800">View all <ArrowUpRight size={14} /></Link>
            </div>
            <ul className="mt-4 grid gap-3 md:grid-cols-3">
              {similar.map((s) => (
                <li key={s.id}>
                  <Link href={`/jobs/${s.id}`} className="group block h-full rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-300">
                    <p className="line-clamp-2 text-sm font-bold text-slate-950 group-hover:text-brand-800">{s.title}</p>
                    <p className="mt-1 truncate text-xs text-slate-600">{s.company_name} · {s.location}</p>
                    <div className="mt-4 flex items-center justify-between gap-2"><span className="text-xs font-bold tabular-nums text-slate-700">{formatRate(s)}</span><IR35Badge status={s.ir35_status} size="xs" /></div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <WorkspaceAwareFooter />
    </div>
  );
}
