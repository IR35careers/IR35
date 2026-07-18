"use client";

/**
 * /jobs — the contract search board.
 *
 * Design notes: continues the site's dark identity. The signature element is
 * the right-hand "rate rail" on every card — day rate in large tabular
 * figures with the IR35 badge directly beneath, so status and money can be
 * scanned straight down the page. Everything else stays quiet.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, MapPin, Loader2 } from "lucide-react";
import { formatPosted, formatRate, type JobListing } from "@/lib/job-types";

interface SearchResponse {
  jobs: JobListing[];
  total: number;
  page: number;
  per_page: number;
  error?: string;
}

const RATE_OPTIONS = [0, 300, 400, 500, 600, 700] as const;

function IR35Badge({ status }: { status: JobListing["ir35_status"] }) {
  if (status === "outside") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
        Outside IR35
      </span>
    );
  }
  if (status === "inside") {
    return (
      <span className="inline-flex items-center rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-0.5 text-xs font-medium text-sky-300">
        Inside IR35
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-white/50">
      IR35: TBC
    </span>
  );
}

function RemoteTag({ type }: { type: JobListing["remote_type"] }) {
  if (type === "unknown") return null;
  const label = type === "remote" ? "Remote" : type === "hybrid" ? "Hybrid" : "On-site";
  return (
    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-white/70">
      {label}
    </span>
  );
}

export default function JobsPage() {
  const [q, setQ] = useState("");
  const [ir35, setIr35] = useState<"" | "outside" | "inside">("");
  const [remote, setRemote] = useState("");
  const [minRate, setMinRate] = useState(0);
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (params: URLSearchParams) => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/jobs/search?${params.toString()}`);
      const json = (await res.json()) as SearchResponse;
      if (!res.ok || json.error) throw new Error(json.error ?? "Search failed");
      setData(json);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (ir35) params.set("ir35", ir35);
    if (remote) params.set("remote", remote);
    if (minRate > 0) params.set("min_rate", String(minRate));
    if (sort !== "recent") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(params), q ? 350 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, ir35, remote, minRate, sort, page, runSearch]);

  // Any filter change returns to page 1.
  const resetPage = () => setPage(1);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {/* Header */}
        <header className="mb-8">
          <Link href="/" className="text-sm text-white/40 transition-colors hover:text-white/70">
            IR35Careers
          </Link>
          <h1 className="mt-2 text-3xl font-light tracking-tight sm:text-4xl">
            UK contract roles, <span className="text-white/60">IR35 status up front</span>
          </h1>
        </header>

        {/* Filters */}
        <div className="mb-6 space-y-3">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                resetPage();
              }}
              placeholder="Search roles, skills, companies…"
              className="w-full rounded-xl border border-white/15 bg-white/5 py-3 pl-10 pr-4 text-sm placeholder:text-white/35 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              aria-label="Search contracts"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* IR35 segmented control — the product's core filter */}
            <div className="inline-flex rounded-lg border border-white/15 bg-white/5 p-0.5" role="group" aria-label="IR35 status">
              {([
                ["", "All"],
                ["outside", "Outside"],
                ["inside", "Inside"],
              ] as const).map(([value, label]) => (
                <button
                  key={label}
                  onClick={() => {
                    setIr35(value);
                    resetPage();
                  }}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    ir35 === value ? "bg-white text-black" : "text-white/60 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <select
              value={remote}
              onChange={(e) => {
                setRemote(e.target.value);
                resetPage();
              }}
              aria-label="Workplace type"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 [&>option]:bg-neutral-900"
            >
              <option value="">Any workplace</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>

            <select
              value={minRate}
              onChange={(e) => {
                setMinRate(Number(e.target.value));
                resetPage();
              }}
              aria-label="Minimum day rate"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 [&>option]:bg-neutral-900"
            >
              {RATE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? "Any rate" : `£${r}+/day`}
                </option>
              ))}
            </select>

            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                resetPage();
              }}
              aria-label="Sort order"
              className="ml-auto rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 [&>option]:bg-neutral-900"
            >
              <option value="recent">Newest first</option>
              <option value="rate_high">Highest rate</option>
              <option value="rate_low">Lowest rate</option>
            </select>
          </div>
        </div>

        {/* Result count */}
        <p className="mb-4 text-sm text-white/50" aria-live="polite">
          {loading ? "Searching…" : data ? `${data.total.toLocaleString()} contracts` : ""}
        </p>

        {/* Results */}
        {failed ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <p className="text-white/80">Couldn&apos;t load contracts.</p>
            <p className="mt-1 text-sm text-white/50">Check your connection and refresh to try again.</p>
          </div>
        ) : loading && !data ? (
          <div className="flex items-center justify-center py-24 text-white/50">
            <Loader2 className="animate-spin" size={22} />
          </div>
        ) : data && data.jobs.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <p className="text-white/80">No contracts match these filters.</p>
            <p className="mt-1 text-sm text-white/50">
              Try clearing the rate filter or broadening your search terms.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {data?.jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="group flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-colors hover:border-white/25 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-medium text-white group-hover:text-white sm:text-lg">
                      {job.title}
                    </h2>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-white/50">
                      <span className="text-white/70">{job.company_name}</span>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} /> {job.location}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{formatPosted(job)}</span>
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <RemoteTag type={job.remote_type} />
                      {job.skills.slice(0, 5).map((skill) => (
                        <span
                          key={skill}
                          className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-white/50"
                        >
                          {skill}
                        </span>
                      ))}
                      {job.skills.length > 5 && (
                        <span className="text-xs text-white/35">+{job.skills.length - 5}</span>
                      )}
                    </div>
                  </div>

                  {/* Rate rail — the signature */}
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-right text-lg font-semibold tabular-nums tracking-tight">
                      {formatRate(job)}
                    </span>
                    <IR35Badge status={job.ir35_status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Pagination */}
        {data && data.total > data.per_page && (
          <nav className="mt-8 flex items-center justify-center gap-4" aria-label="Pagination">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Previous
            </button>
            <span className="text-sm text-white/50 tabular-nums">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Next
            </button>
          </nav>
        )}
      </div>
    </main>
  );
}
