import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { JOB_LIST_COLUMNS, formatPosted, formatRate, type JobListing } from "@/lib/job-types";
import { getSeoPage, relatedSeoPages, type SeoPage } from "@/lib/seo-pages";

// ISR: cached HTML for speed (Google cares), refreshed hourly.
export const revalidate = 3600;
export const dynamicParams = true;

const PAGE_SIZE = 20;

async function fetchPageData(page: SeoPage) {
  let query = supabase
    .from("jobs")
    .select(JOB_LIST_COLUMNS, { count: "exact" })
    .is("expired_at", null);

  const f = page.filters;
  if (f.skill) query = query.contains("skills", [f.skill]);
  if (f.location) query = query.ilike("location", `%${f.location}%`);
  if (f.ir35) query = query.eq("ir35_status", f.ir35);
  if (f.remote) query = query.eq("remote_type", "remote");

  query = query
    .order("posted_on", { ascending: false, nullsFirst: false })
    .order("rate_max", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE);

  const { data, count, error } = await query;
  if (error) return { jobs: [] as JobListing[], total: 0 };
  return { jobs: (data ?? []) as unknown as JobListing[], total: count ?? 0 };
}

function rateSummary(jobs: JobListing[]): string | null {
  const daily = jobs
    .filter((j) => j.rate_type === "daily")
    .map((j) => j.rate_max ?? j.rate_min)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  if (daily.length < 3) return null;
  const lo = daily[Math.floor(daily.length * 0.25)];
  const hi = daily[Math.floor(daily.length * 0.75)];
  return `£${lo.toLocaleString()}-£${hi.toLocaleString()}/day typical`;
}

function boardLink(page: SeoPage): string {
  const params = new URLSearchParams();
  if (page.filters.skill) params.set("skills", page.filters.skill);
  if (page.filters.location) params.set("location", page.filters.location);
  if (page.filters.ir35) params.set("ir35", page.filters.ir35);
  if (page.filters.remote) params.set("remote", "remote");
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getSeoPage(slug);
  if (!page) return { title: "Not found | IR35Careers" };
  const url = `https://ir35careers.com/contracts/${page.slug}`;
  return {
    title: `${page.metaTitle} | IR35Careers`,
    description: page.metaDescription,
    alternates: { canonical: url },
    openGraph: { title: page.metaTitle, description: page.metaDescription, url },
  };
}

export default async function ContractsSeoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = getSeoPage(slug);
  if (!page) notFound();

  const { jobs, total } = await fetchPageData(page);
  const rates = rateSummary(jobs);
  const related = relatedSeoPages(page);
  const accent = page.filters.ir35 === "inside" ? "sky" : "emerald";

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div
          className={`absolute -top-40 right-[-10%] h-[440px] w-[440px] rounded-full blur-[120px] ${
            accent === "sky" ? "bg-rose-500/[0.12]" : "bg-green-200/50"
          }`}
        />
        <div className="absolute bottom-[-15%] left-[-10%] h-[440px] w-[440px] rounded-full bg-white blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-[1500px] px-4 py-10 sm:px-6">
        <nav className="flex items-center gap-2 text-sm text-slate-400" aria-label="Breadcrumb">
          <Link href="/" className="transition-colors hover:text-slate-600">
            IR35Careers
          </Link>
          <span aria-hidden>/</span>
          <Link href="/jobs" className="transition-colors hover:text-slate-600">
            Contracts
          </Link>
        </nav>

        <header className="mt-5">
          <h1 className="text-3xl font-light tracking-tight sm:text-4xl">{page.h1}</h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            {total > 0 ? (
              <>
                <span className="font-medium text-white/90">{total.toLocaleString()}</span> live{" "}
                {total === 1 ? "role" : "roles"}
                {rates ? <> · {rates}</> : null} · IR35 status shown only when stated in the
                original listing.
              </>
            ) : (
              <>No live roles right now. New contracts arrive throughout the day.</>
            )}
          </p>
          <Link
            href={boardLink(page)}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            Search &amp; filter these roles <ArrowRight size={14} />
          </Link>
        </header>

        {/* Listings */}
        {jobs.length > 0 && (
          <ul className="mt-8 space-y-3">
            {jobs.map((job) => {
              const hasRate = job.rate_min !== null || job.rate_max !== null;
              return (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 pl-6 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <span
                      className={`absolute inset-y-0 left-0 w-[3px] ${
                        job.ir35_status === "outside"
                          ? "bg-green-500"
                          : job.ir35_status === "inside"
                            ? "bg-rose-500"
                            : "bg-slate-200"
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <h2 className="text-base font-medium sm:truncate">{job.title}</h2>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
                        <span className="text-slate-700">{job.company_name}</span>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin size={12} /> {job.location}
                        </span>
                        <span aria-hidden>·</span>
                        <span>{formatPosted(job)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
                      {hasRate ? (
                        <span className="font-semibold tabular-nums">{formatRate(job)}</span>
                      ) : (
                        <span className="text-sm text-slate-400">Rate on application</span>
                      )}
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          job.ir35_status === "outside"
                            ? "border-green-200 bg-green-50 text-green-700"
                            : job.ir35_status === "inside"
                              ? "border-rose-200 bg-rose-50 text-rose-600"
                              : "border-slate-300 bg-slate-100 text-slate-500"
                        }`}
                      >
                        {job.ir35_status === "outside"
                          ? "Outside IR35"
                          : job.ir35_status === "inside"
                            ? "Inside IR35"
                            : "IR35: TBC"}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {total > PAGE_SIZE && (
          <p className="mt-6 text-center">
            <Link
              href={boardLink(page)}
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 underline-offset-4 transition-colors hover:text-slate-900 hover:underline"
            >
              View all {total.toLocaleString()} roles on the live board <ArrowRight size={13} />
            </Link>
          </p>
        )}

        {/* Internal links */}
        {related.length > 0 && (
          <section className="mt-12 border-t border-slate-200/70 pt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
              Related searches
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/contracts/${r.slug}`}
                  className="rounded-full border border-slate-300 bg-slate-50 px-3.5 py-1.5 text-sm text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  {r.h1}
                </Link>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-14 border-t border-slate-200/70 pt-6 text-center text-xs text-slate-400">
          Updated daily · Sources: employer career boards, Reed, Adzuna
        </footer>
      </div>
    </main>
  );
}
