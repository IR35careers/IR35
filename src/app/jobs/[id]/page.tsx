import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, ArrowUpRight, MapPin, Clock, PoundSterling, Briefcase, Sparkles } from "lucide-react";
import { ApplyButton } from "@/components/ApplyButton";
import { IR35EvidencePanel } from "@/components/IR35EvidencePanel";
import { SaveJobButton } from "@/components/SaveJobButton";
import { JobMatchPanel } from "@/components/JobMatchPanel";
import { PublicHeader } from "@/components/PublicHeader";
import { WorkspaceAwareFooter } from "@/components/WorkspaceAwareFooter";
import { IR35Badge } from "@/components/ui/ir35-badge";
import { CompanyLogo } from "@/components/ui/company-logo";
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
    { icon: PoundSterling, label: job.rate_type === "annual" ? "Salary" : job.rate_type === "hourly" ? "Hourly rate" : "Day rate", value: formatRate(job), tone: "from-emerald-50 to-white text-emerald-800" },
    { icon: MapPin, label: "Location", value: job.location || "Not stated", tone: "from-cyan-50 to-white text-cyan-800" },
    { icon: Briefcase, label: "Workplace", value: remoteLabel ?? "Not stated", tone: "from-violet-50 to-white text-violet-800" },
    { icon: Clock, label: "Posted", value: formatPosted(job), tone: "from-amber-50 to-white text-amber-800" },
  ];

  return (
    <div className="ir35-workspace-canvas min-h-screen text-slate-900">
      <PublicHeader hideForWorkspaceMembers />

      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-8">
        <Link href="/jobs" className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-full px-2 text-sm font-semibold text-slate-600 transition-colors hover:text-emerald-800">
          <ArrowLeft size={14} /> Back to contracts
        </Link>

        <header className="relative mt-3 overflow-hidden rounded-[2rem] border border-emerald-300/20 bg-[linear-gradient(135deg,#06161c_0%,#0a302d_58%,#126a60_100%)] p-5 text-white shadow-[0_28px_80px_-42px_rgba(5,46,42,0.85)] sm:p-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 h-80 w-80 rounded-full border-[60px] border-cyan-300/10" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 left-1/3 h-52 w-52 rounded-full bg-emerald-300/10 blur-3xl" />
          <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-end">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-200"><Sparkles size={14} /> Contract opportunity</p>
              <h1 className="mt-4 max-w-5xl text-[clamp(2rem,4vw,3.35rem)] font-black leading-[1.02] tracking-[-0.045em] text-white">{job.title}</h1>
              <div className="mt-4 flex items-center gap-3"><CompanyLogo companyName={job.company_name} className="h-12 w-12 rounded-2xl" /><p className="text-base font-semibold text-slate-200 sm:text-lg">{job.company_name}</p></div>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <IR35Badge status={job.ir35_status} />
                {remoteLabel && (
                  <span className="inline-flex min-h-8 items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm font-semibold text-white backdrop-blur">
                    {remoteLabel}
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-[1.45rem] border border-white/15 bg-slate-950/25 p-3.5 shadow-inner backdrop-blur-md sm:p-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-emerald-200">Ready when you are</p>
              <ApplyButton jobId={job.id} sourceDomain={job.source_domain} />
              <div className="mt-2 [&_button]:border-white/20 [&_button]:bg-white/95">
                <SaveJobButton jobId={job.id} />
              </div>
            </div>
          </div>
        </header>

        {isDemo && (
          <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            This preview listing is available only in the local workspace.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {factCards.map((f) => (
            <div key={f.label} className={`group rounded-[1.35rem] border border-white/80 bg-gradient-to-br ${f.tone} p-4 shadow-[0_18px_48px_-38px_rgba(15,23,42,0.65)] transition-transform duration-300 hover:-translate-y-0.5 sm:p-5`}>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 shadow-sm"><f.icon size={17} /></span>
              <p className="mt-3 break-words text-base font-bold tabular-nums text-slate-950 sm:text-lg">{f.value}</p>
              <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{f.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_350px]">
          {/* Main content */}
          <div className="min-w-0">
            <section className="rounded-[1.75rem] border border-white/90 bg-white/95 p-5 shadow-[0_22px_70px_-52px_rgba(15,23,42,0.72)] backdrop-blur sm:p-8">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Briefcase size={18} /></span>
                <div><p className="text-[11px] font-bold uppercase tracking-[0.17em] text-emerald-700">The contract</p><h2 className="text-xl font-bold tracking-tight text-slate-950">Role description</h2></div>
              </div>
              <div className="mt-6 whitespace-pre-line text-[15px] leading-7 text-slate-700 sm:text-base sm:leading-8">
                {job.description || "Full details are on the original listing."}
              </div>
              {job.skills.length > 0 && (
                <div className="mt-7 border-t border-slate-200 pt-6">
                  <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-600">Skills in this listing</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                  {job.skills.map((skill) => (
                    <span key={skill} className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-900">
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
          <section className="mt-9 rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_20px_65px_-52px_rgba(15,23,42,0.65)] backdrop-blur sm:p-7">
            <div className="flex items-end justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Keep exploring</p><h2 className="mt-1 text-xl font-bold text-slate-950">Similar contracts</h2></div>
              <Link href="/jobs" className="ir35-focus inline-flex min-h-10 items-center gap-1 text-sm font-bold text-brand-800">View all <ArrowUpRight size={14} /></Link>
            </div>
            <ul className="mt-4 grid gap-3 md:grid-cols-3">
              {similar.map((s) => (
                <li key={s.id}>
                  <Link href={`/jobs/${s.id}`} className="group block h-full rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-emerald-50/60 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg">
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
