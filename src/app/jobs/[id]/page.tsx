import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, MapPin, Clock, PoundSterling, Building2, Briefcase, ClipboardCheck, WandSparkles } from "lucide-react";
import { ApplyButton } from "@/components/ApplyButton";
import { IR35EvidencePanel } from "@/components/IR35EvidencePanel";
import { SaveJobButton } from "@/components/SaveJobButton";
import { JobMatchPanel } from "@/components/JobMatchPanel";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { IR35Badge } from "@/components/ui/ir35-badge";
import { formatPosted, formatRate, type JobDetail, type JobListing } from "@/lib/job-types";
import { deriveIR35Provenance } from "@/lib/ir35-provenance";
import { getPublicJob, getSimilarPublicJobs } from "@/lib/public-jobs";

export const dynamic = "force-static";
export const revalidate = 60;

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
  if (!job) return { title: "Contract not found | IR35Careers" };
  const status =
    job.ir35_status === "outside" ? "Outside IR35" : job.ir35_status === "inside" ? "Inside IR35" : "";
  return {
    title: `${job.title} at ${job.company_name}${status ? ` (${status})` : ""} | IR35Careers`,
    description: `${formatRate(job)} · ${job.location}. Apply for this UK contract role on IR35Careers.`,
  };
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  const similar = await getSimilar(job);
  const isDemo = job.source_domain === "demo.ir35careers.local";
  const ir35Provenance = deriveIR35Provenance(job);

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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />

      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
        <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-slate-600 transition-colors hover:text-slate-900">
          <ArrowLeft size={14} /> Back to contracts
        </Link>

        {/* Title row */}
        <header className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{job.title}</h1>
            <p className="mt-1.5 text-slate-600">{job.company_name}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <IR35Badge status={job.ir35_status} />
              {remoteLabel && (
                <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600">
                  {remoteLabel}
                </span>
              )}
              <span className="text-xs text-slate-600">{ir35Provenance.shortLabel}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href={`/applications/new/${job.id}`}
              className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-card hover:bg-brand-700"
            >
              <ClipboardCheck size={16} aria-hidden="true" /> Prepare application
            </Link>
            <Link
              href={`/jobs/${job.id}/resume`}
              className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brand-300 bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-800 shadow-card hover:bg-brand-100"
            >
              <WandSparkles size={16} aria-hidden="true" /> Tailor CV to this role
            </Link>
            <ApplyButton applyUrl={job.apply_url} sourceDomain={job.source_domain} />
            <SaveJobButton jobId={job.id} />
          </div>
        </header>

        {isDemo && (
          <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            Preview listing - connect Supabase locally to open live contract details.
          </p>
        )}

        {/* Fact cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {factCards.map((f) => (
            <div key={f.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <f.icon size={16} className="text-green-600" />
              <p className="mt-2 break-words text-base font-semibold tabular-nums text-slate-900 sm:text-lg">{f.value}</p>
              <p className="text-xs uppercase tracking-wide text-slate-600">{f.label}</p>
            </div>
          ))}
        </div>

        {/* Three columns */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Main content */}
          <div className="min-w-0 space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Role description</h2>
              <div className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">
                {job.description || "Full details are on the original listing."}
              </div>
            </section>

            {job.skills.length > 0 && (
              <section className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Skills</h2>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {job.skills.map((skill) => (
                    <span key={skill} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-600">
                      {skill}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-800">{job.company_name}</h2>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                This role is advertised via {job.source_domain.replace("www.", "")}. Applications open on the
                original listing. IR35Careers never sits between you and the client.
              </p>
            </section>
          </div>

          {/* Right rail */}
          <div className="space-y-6">
            <IR35EvidencePanel job={job} />
            <JobMatchPanel job={job} />

            {similar.length > 0 && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-800">Similar contracts</h2>
                <ul className="mt-3 divide-y divide-slate-100">
                  {similar.map((s) => (
                    <li key={s.id}>
                      <Link href={`/jobs/${s.id}`} className="block py-3 transition-colors hover:bg-slate-50">
                        <p className="truncate text-sm font-medium text-slate-900">{s.title}</p>
                        <p className="truncate text-xs text-slate-600">{s.company_name} · {s.location}</p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold tabular-nums text-slate-700">{formatRate(s)}</span>
                          <IR35Badge status={s.ir35_status} size="xs" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold text-slate-800">Contractor tools</p>
              <Link href={`/jobs/${job.id}/resume`} className="mt-3 block rounded-xl border border-brand-200 bg-brand-50/60 p-3 text-sm transition-colors hover:border-brand-300 hover:bg-brand-50">
                <span className="flex items-center gap-2 font-semibold text-brand-800"><WandSparkles size={15} aria-hidden="true" /> CV Studio</span>
                <span className="mt-1 block text-xs leading-5 text-brand-900/75">Score, tailor, approve and export for this role</span>
              </Link>
              <Link href="/tools/take-home" className="mt-3 block rounded-xl border border-slate-200 p-3 text-sm transition-colors hover:border-green-300 hover:bg-green-50/30">
                <span className="font-medium text-slate-800">Take-home calculator</span>
                <span className="block text-xs text-slate-600">See what this rate nets you</span>
              </Link>
            </section>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
