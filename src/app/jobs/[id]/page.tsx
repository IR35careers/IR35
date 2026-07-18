import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, MapPin, Clock } from "lucide-react";
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
      <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm font-medium text-emerald-300">
        Outside IR35
      </span>
    );
  if (status === "inside")
    return (
      <span className="inline-flex items-center rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-sm font-medium text-sky-300">
        Inside IR35
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm text-white/50">
      IR35 status to be confirmed
    </span>
  );
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  const remoteLabel =
    job.remote_type === "remote"
      ? "Remote"
      : job.remote_type === "hybrid"
        ? "Hybrid"
        : job.remote_type === "onsite"
          ? "On-site"
          : null;

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-black text-white">
      {/* Ambient identity glows matching the board */}
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div
          className={`absolute -top-40 right-[-10%] h-[420px] w-[420px] rounded-full blur-[120px] ${
            job.ir35_status === "inside" ? "bg-sky-500/[0.13]" : "bg-emerald-500/[0.13]"
          }`}
        />
        <div className="absolute bottom-[-15%] left-[-10%] h-[420px] w-[420px] rounded-full bg-white/[0.03] blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded"
        >
          <ArrowLeft size={14} /> All contracts
        </Link>

        <header className="mt-6">
          <h1 className="text-2xl font-light tracking-tight sm:text-3xl">{job.title}</h1>
          <p className="mt-2 text-white/70">{job.company_name}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={job.ir35_status} />
            {remoteLabel && (
              <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm text-white/70">
                {remoteLabel}
              </span>
            )}
          </div>
        </header>

        {/* Key facts */}
        <dl className="mt-6 grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-white/40">Rate</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{formatRate(job)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-white/40">Location</dt>
            <dd className="mt-1 inline-flex items-center gap-1.5 text-white/90">
              <MapPin size={14} className="text-white/40" /> {job.location}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-white/40">Posted</dt>
            <dd className="mt-1 inline-flex items-center gap-1.5 text-white/90">
              <Clock size={14} className="text-white/40" /> {formatPosted(job)}
            </dd>
          </div>
        </dl>

        {/* Apply */}
        <div className="mt-6">
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Apply on {job.source_domain.replace("www.", "")} <ExternalLink size={14} />
          </a>
          <p className="mt-2 text-xs text-white/40">
            Applications open on the original listing — IR35Careers never sits between you and the
            client.
          </p>
        </div>

        {/* Description */}
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-white/40">
            Role description
          </h2>
          <div className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-white/80">
            {job.description || "Full details are on the original listing."}
          </div>
        </section>

        {/* Skills */}
        {job.skills.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-white/40">Skills</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/70"
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
