import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowLeft, CheckCircle2, Clock3, Database, RefreshCw, TriangleAlert } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { getPublicSourceHealth, type FeedHealthStatus, type SourceFreshness } from "@/lib/source-health";

export const metadata: Metadata = {
  title: "Contract Feed Health | IR35Careers",
  description: "See source freshness, active contract coverage and stale-listing controls for the IR35Careers job feed.",
};
export const revalidate = 300;

const statusStyle: Record<FeedHealthStatus, { label: string; text: string; className: string }> = {
  healthy: { label: "Fresh", text: "Every observed source has refreshed most of its active inventory within the last two days.", className: "border-emerald-200 bg-emerald-50 text-emerald-950" },
  mixed: { label: "Mixed freshness", text: "One or more sources have only partially refreshed, are delayed, or are stale.", className: "border-amber-200 bg-amber-50 text-amber-950" },
  stale: { label: "Refresh delayed", text: "All observed sources are beyond the normal freshness window.", className: "border-rose-200 bg-rose-50 text-rose-950" },
  unavailable: { label: "Unavailable", text: "Source freshness could not be calculated right now.", className: "border-slate-300 bg-slate-100 text-slate-800" },
};

const freshnessLabel: Record<SourceFreshness, string> = {
  fresh: "Fresh",
  delayed: "Delayed",
  stale: "Stale",
  unknown: "Unknown",
};

function formatObserved(value: string | null): string {
  if (!value) return "Observation time unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Observation time unavailable";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(date);
}

export default async function SourceHealthPage() {
  let health;
  try {
    health = await getPublicSourceHealth();
  } catch {
    health = null;
  }
  const state = statusStyle[health?.status ?? "unavailable"];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <PublicHeader />
      <main className="ir35-container py-10 sm:py-14">
        <Link href="/jobs" className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-lg text-sm font-semibold text-slate-600 hover:text-brand-700"><ArrowLeft size={15} /> Back to contracts</Link>
        <div className="mt-5 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Source transparency</p>
          <h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Contract feed health</h1>
          <p className="mt-5 text-base leading-7 text-slate-600">A cached, privacy-safe view of active listing counts and how much of each source has been observed recently. This reports feed freshness, not whether an individual vacancy is guaranteed open.</p>
        </div>

        <section aria-label="Feed health summary" className={`mt-8 rounded-3xl border p-6 shadow-card sm:p-8 ${state.className}`}>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em]"><Activity size={15} /> Overall status</p><h2 className="mt-2 text-2xl font-bold">{state.label}</h2><p className="mt-2 max-w-2xl text-sm leading-6 opacity-80">{state.text}</p></div>
            {health?.dataSource === "demo" && <span className="rounded-full border border-current/20 bg-white/60 px-3 py-1 text-xs font-bold">Labelled preview data</span>}
          </div>
          {health && <dl className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-white/70 p-4"><dt className="text-xs font-semibold uppercase tracking-wide opacity-70">Active contracts</dt><dd className="mt-1 text-2xl font-bold tabular-nums">{health.truncated ? `${health.activeJobs.toLocaleString()}+` : health.activeJobs.toLocaleString()}</dd></div><div className="rounded-2xl bg-white/70 p-4"><dt className="text-xs font-semibold uppercase tracking-wide opacity-70">Recently observed</dt><dd className="mt-1 text-2xl font-bold tabular-nums">{health.freshPercent}%</dd></div><div className="rounded-2xl bg-white/70 p-4"><dt className="text-xs font-semibold uppercase tracking-wide opacity-70">Fresh sources</dt><dd className="mt-1 text-2xl font-bold tabular-nums">{health.freshSources}/{health.sourceCount}</dd></div></dl>}
        </section>

        {health && health.sources.length > 0 ? (
          <section className="mt-8" aria-labelledby="source-list-title">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="source-list-title" className="text-2xl font-bold">Source observations</h2><p className="mt-1 text-sm text-slate-600">Recent coverage and latest successful observation for each source.</p></div><p className="text-xs text-slate-500">Summary generated {formatObserved(health.generatedAt)}</p></div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {health.sources.map((source) => {
                const Icon = source.freshness === "fresh" ? CheckCircle2 : source.freshness === "unknown" ? Clock3 : TriangleAlert;
                const badge = source.freshness === "fresh" ? "bg-emerald-100 text-emerald-800" : source.freshness === "delayed" ? "bg-amber-100 text-amber-800" : source.freshness === "stale" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700";
                return <article key={source.domain} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><div className="flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Database size={18} /></span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badge}`}><Icon className="mr-1 inline" size={13} />{freshnessLabel[source.freshness]}</span></div><h3 className="mt-4 text-lg font-bold">{source.label}</h3><p className="mt-0.5 truncate text-xs text-slate-500" title={source.domain}>{source.domain}</p><div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-3xl font-bold tabular-nums">{source.activeJobs.toLocaleString()}</p><p className="text-xs text-slate-500">active contracts</p></div><div className="text-right"><p className="text-xl font-bold tabular-nums text-brand-700">{source.freshPercent}%</p><p className="text-xs text-slate-500">recently observed</p></div></div><p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-600">Latest observation: {formatObserved(source.lastObservedAt)}{source.ageDays !== null ? ` · ${source.ageDays === 0 ? "today" : `${source.ageDays} day${source.ageDays === 1 ? "" : "s"} ago`}` : ""}</p></article>;
              })}
            </div>
          </section>
        ) : <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center"><RefreshCw className="mx-auto text-slate-400" /><h2 className="mt-3 font-bold">Feed health is temporarily unavailable</h2><p className="mt-1 text-sm text-slate-600">Contract search remains available. Try this status page again shortly.</p></section>}

        <section className="mt-10 grid gap-4 md:grid-cols-3" aria-label="Feed safeguards"><article className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Daily refresh</h2><p className="mt-2 text-sm leading-6 text-slate-600">Supported ATS and authorised job-board sources are fetched within a bounded serverless run. One source failure does not discard successful sources.</p></article><article className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Duplicate reduction</h2><p className="mt-2 text-sm leading-6 text-slate-600">Stable source identifiers prevent repeat imports and a secondary comparison reduces the same engagement appearing across providers.</p></article><article className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Ten-day expiry</h2><p className="mt-2 text-sm leading-6 text-slate-600">Listings not observed for {health?.staleWindowDays ?? 10} days are removed from active results at the next successful pipeline run. Always verify the original advert.</p></article></section>
      </main>
      <PublicFooter />
    </div>
  );
}
