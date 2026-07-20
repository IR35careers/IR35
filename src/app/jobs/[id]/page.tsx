import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Clock, PoundSterling, Building2, Briefcase } from "lucide-react";
import { ApplyButton } from "@/components/ApplyButton";
import { SaveJobButton } from "@/components/SaveJobButton";
import { JobMatchPanel } from "@/components/JobMatchPanel";
import { PublicHeader } from "@/components/PublicHeader";
import { supabase } from "@/lib/supabase";
import { formatPosted, formatRate, type JobDetail, type JobListing } from "@/lib/job-types";

export const dynamic = "force-dynamic";

const DETAIL_COLUMNS =
  "id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at, description, apply_url, source_domain";

async function getJob(id: string): Promise<JobDetail | null> {
  // Guard: only well-formed UUIDs reach the database.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data, error } = await supabase
    .from("jobs")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .is("expired_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as JobDetail;
}

/** Live "similar contracts": same skills, not this job, newest first. */
async function getSimilar(job: JobDetail): Promise<JobListing[]> {
  let query = supabase
    .from("jobs")
    .select("id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at")
    .is("expired_at", null)
    .neq("id", job.id)
    .limit(6);
  if (job.skills.length > 0) query = query.overlaps("skills", job.skills.slice(0, 8));
  const { data } = await query;
  return (data ?? []) as unknown as JobListing[];
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
    title: `${job.title} — ${job.company_name}${status ? ` (${status})` : ""} | IR35Careers`,
    description: `${formatRate(job)} · ${job.location}. Apply for this UK contract role on IR35Careers.`,
  };
}

function StatusBadge({ status }: { status: JobDetail["ir35_status"] }) {
  if (status === "outside")
    return (
      <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
        Outside IR35
      </span>
    );
  if (status === "inside")
    return (
      <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-sm font-medium text-rose-600">
        Inside IR35
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-sm text-slate-500">
      IR35 status to be confirmed
    </span>
  );
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  const similar = await getSimilar(job);

  // Google Jobs structured data. Only fields we actually know are included —
  // never fabricated. validThrough: 30 days from the best-known date.
  const postedIso = job.posted_at ?? job.first_seen_at;
  const validThrough = new Date(new Date(postedIso).getTime() + 30 * 86_400_000).toISOString();
  const jobPostingLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description || job.title,
    datePosted: postedIso,
    validThrough,
    employmentType: "CONTRACTOR",
    hiringOrganization: { "@type": "Organization", name: job.company_name },
    directApply: false,
  };
  if (job.remote_type === "remote") {
    jobPostingLd.jobLocationType = "TELECOMMUTE";
    jobPostingLd.applicantLocationRequirements = { "@type": "Country", name: "United Kingdom" };
  } else {
    jobPostingLd.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location,
        addressCountry: "GB",
      },
    };
  }
  const rateBasis = job.rate_max ?? job.rate_min;
  if (rateBasis !== null && job.rate_type !== "unknown") {
    jobPostingLd.baseSalary = {
      "@type": "MonetaryAmount",
      currency: job.rate_currency ?? "GBP",
      value: {
        "@type": "QuantitativeValue",
        ...(job.rate_min !== null && job.rate_max !== null && job.rate_min !== job.rate_max
          ? { minValue: job.rate_min, maxValue: job.rate_max }
          : { value: rateBasis }),
        unitText: job.rate_type === "daily" ? "DAY" : job.rate_type === "hourly" ? "HOUR" : "YEAR",
      },
    };
  }

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
    { icon: MapPin, label: "Location", value: job.location || "—" },
    { icon: Briefcase, label: "Workplace", value: remoteLabel ?? "—" },
    { icon: Clock, label: "Posted", value: formatPosted(job) },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingLd) }} />

      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
        <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800">
          <ArrowLeft size={14} /> Back to contracts
        </Link>

        {/* Title row */}
        <header className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{job.title}</h1>
            <p className="mt-1.5 text-slate-600">{job.company_name}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={job.ir35_status} />
              {remoteLabel && (
                <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600">
                  {remoteLabel}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <ApplyButton applyUrl={job.apply_url} sourceDomain={job.source_domain} jobId={job.id} />
            <SaveJobButton jobId={job.id} />
          </div>
        </header>

        {/* Fact cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {factCards.map((f) => (
            <div key={f.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <f.icon size={16} className="text-green-600" />
              <p className="mt-2 truncate text-lg font-semibold tabular-nums text-slate-900">{f.value}</p>
              <p className="text-xs uppercase tracking-wide text-slate-400">{f.label}</p>
            </div>
          ))}
        </div>

        {/* Three columns */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Main content */}
          <div className="min-w-0 space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Role description</h2>
              <div className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">
                {job.description || "Full details are on the original listing."}
              </div>
            </section>

            {job.skills.length > 0 && (
              <section className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Skills</h2>
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
              <p className="mt-2 text-sm text-slate-500">
                This role is advertised via {job.source_domain.replace("www.", "")}. Applications open on the
                original listing — IR35Careers never sits between you and the client.
              </p>
            </section>
          </div>

          {/* Right rail */}
          <div className="space-y-6">
            <JobMatchPanel job={job} />

            {similar.length > 0 && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-800">Similar contracts</h2>
                <ul className="mt-3 divide-y divide-slate-100">
                  {similar.map((s) => (
                    <li key={s.id}>
                      <Link href={`/jobs/${s.id}`} className="block py-3 transition-colors hover:bg-slate-50">
                        <p className="truncate text-sm font-medium text-slate-900">{s.title}</p>
                        <p className="truncate text-xs text-slate-500">{s.company_name} · {s.location}</p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold tabular-nums text-slate-700">{formatRate(s)}</span>
                          {s.ir35_status === "outside" ? (
                            <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">Outside IR35</span>
                          ) : s.ir35_status === "inside" ? (
                            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600">Inside IR35</span>
                          ) : (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">TBC</span>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold text-slate-800">Contractor tools</p>
              <Link href="/tools/take-home" className="mt-3 block rounded-xl border border-slate-200 p-3 text-sm transition-colors hover:border-green-300 hover:bg-green-50/30">
                <span className="font-medium text-slate-800">Take-home calculator</span>
                <span className="block text-xs text-slate-500">See what this rate nets you</span>
              </Link>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
