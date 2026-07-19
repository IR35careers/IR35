import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Clock } from "lucide-react";
import { ApplyButton } from "@/components/ApplyButton";
import { SaveJobButton } from "@/components/SaveJobButton";
import { supabase } from "@/lib/supabase";
import { formatPosted, formatRate, type JobDetail } from "@/lib/job-types";

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
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
        Outside IR35
      </span>
    );
  if (status === "inside")
    return (
      <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700">
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

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-slate-50 text-slate-900">
      {/* Ambient identity glows matching the board */}
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div
          className={`absolute -top-40 right-[-10%] h-[420px] w-[420px] rounded-full blur-[120px] ${
            job.ir35_status === "inside" ? "bg-sky-200/50" : "bg-emerald-200/50"
          }`}
        />
        <div className="absolute bottom-[-15%] left-[-10%] h-[420px] w-[420px] rounded-full bg-white blur-[130px]" />
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingLd) }}
      />
      <div className="relative mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 rounded"
        >
          <ArrowLeft size={14} /> All contracts
        </Link>

        <header className="mt-6">
          <h1 className="text-2xl font-light tracking-tight sm:text-3xl">{job.title}</h1>
          <p className="mt-2 text-slate-600">{job.company_name}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={job.ir35_status} />
            {remoteLabel && (
              <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-sm text-slate-600">
                {remoteLabel}
              </span>
            )}
          </div>
        </header>

        {/* Key facts */}
        <dl className="mt-6 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Rate</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{formatRate(job)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Location</dt>
            <dd className="mt-1 inline-flex items-center gap-1.5 text-white/90">
              <MapPin size={14} className="text-slate-400" /> {job.location}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Posted</dt>
            <dd className="mt-1 inline-flex items-center gap-1.5 text-white/90">
              <Clock size={14} className="text-slate-400" /> {formatPosted(job)}
            </dd>
          </div>
        </dl>

        {/* Apply */}
        <div className="mt-6 flex flex-wrap items-start gap-3">
          <ApplyButton applyUrl={job.apply_url} sourceDomain={job.source_domain} jobId={job.id} />
          <SaveJobButton jobId={job.id} />
        </div>

        {/* Description */}
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
            Role description
          </h2>
          <div className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-800">
            {job.description || "Full details are on the original listing."}
          </div>
        </section>

        {/* Skills */}
        {job.skills.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Skills</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm text-slate-600"
                >
                  {skill}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
