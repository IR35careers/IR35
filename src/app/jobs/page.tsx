"use client";

/**
 * /jobs — the contract search board.
 *
 * Visual identity: continues the homepage's dark glass aesthetic. Ambient
 * emerald/sky glows echo the two IR35 states the whole product is about.
 * Signature: every card carries a status-colored accent bar on its left edge
 * and the rate rail on its right — status and money scannable down both
 * edges of the page.
 */

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, MapPin, Loader2, X } from "lucide-react";
import { formatPosted, formatRate, type JobListing } from "@/lib/job-types";
import { useAuth } from "@/lib/auth-context";
import { AppNav } from "@/components/AppNav";

interface SearchResponse {
  jobs: JobListing[];
  total: number;
  page: number;
  per_page: number;
  error?: string;
}

const RATE_OPTIONS = [0, 300, 400, 500, 600, 700] as const;

const STATUS_ACCENT: Record<JobListing["ir35_status"], string> = {
  outside: "bg-gradient-to-b from-green-300/80 to-green-500/40",
  inside: "bg-gradient-to-b from-green-300/80 to-green-500/40",
  unknown: "bg-slate-200",
};

function IR35Badge({ status }: { status: JobListing["ir35_status"] }) {
  if (status === "outside") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden />
        Outside IR35
      </span>
    );
  }
  if (status === "inside") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-600">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden />
        Inside IR35
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
      IR35: TBC
    </span>
  );
}

function RemoteTag({ type }: { type: JobListing["remote_type"] }) {
  if (type === "unknown") return null;
  const label = type === "remote" ? "Remote" : type === "hybrid" ? "Hybrid" : "On-site";
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
      {label}
    </span>
  );
}

function JobsBoard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const spIr35 = searchParams.get("ir35");
  const spRemote = searchParams.get("remote");
  const spMinRate = parseInt(searchParams.get("min_rate") ?? "", 10);

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [ir35, setIr35] = useState<"" | "outside" | "inside">(
    spIr35 === "outside" || spIr35 === "inside" ? spIr35 : ""
  );
  const [remote, setRemote] = useState(
    spRemote === "remote" || spRemote === "hybrid" || spRemote === "onsite" ? spRemote : ""
  );
  const [minRate, setMinRate] = useState(Number.isFinite(spMinRate) && spMinRate > 0 ? spMinRate : 0);
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  // Deep-link-only filters (set by SEO pages); shown as removable chips.
  const [skillsLock, setSkillsLock] = useState<string[]>(
    (searchParams.get("skills") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  const [locationLock, setLocationLock] = useState(searchParams.get("location") ?? "");

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The board requires an account: bounce logged-out visitors to sign-in,
  // carrying the full intended destination (path + filters) as ?next=.
  useEffect(() => {
    if (!authLoading && !user) {
      const target = `${window.location.pathname}${window.location.search}`;
      router.replace(`/account?next=${encodeURIComponent(target)}`);
    }
  }, [user, authLoading, router]);

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
    if (skillsLock.length > 0) params.set("skills", skillsLock.join(","));
    if (locationLock) params.set("location", locationLock);
    if (sort !== "recent") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(params), q ? 350 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, ir35, remote, minRate, skillsLock, locationLock, sort, page, runSearch]);

  const resetPage = () => setPage(1);

  if (authLoading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav />
    <main className="relative overflow-x-hidden">
      {/* Ambient identity glows — emerald & sky, the two IR35 states */}
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="absolute -top-40 right-[-10%] h-[480px] w-[480px] rounded-full bg-green-200/50 blur-[110px]" />
        <div className="absolute bottom-[-15%] left-[-10%] h-[520px] w-[520px] rounded-full bg-green-200/50 blur-[120px]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.03] to-transparent" />
      </div>

      <div className="relative mx-auto max-w-[1500px] px-4 pb-16 sm:px-6">
        {/* Page title */}
        <div className="flex items-center justify-between pt-7">
          <h1 className="text-xl font-medium tracking-tight sm:text-2xl">Browse contracts</h1>
        </div>

        {/* Sticky filter bar */}
        <div className="sticky top-[104px] sm:top-16 z-20 -mx-4 mt-5 border-b border-slate-200/70 bg-white/90 px-4 py-4 backdrop-blur-xl sm:-mx-6 sm:px-6">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                resetPage();
              }}
              placeholder="Search roles, skills, companies…"
              className="w-full rounded-xl border border-slate-300 bg-slate-100 py-3 pl-10 pr-4 text-sm placeholder:text-slate-400 transition-colors focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              aria-label="Search contracts"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5"
              role="group"
              aria-label="IR35 status"
            >
              {(
                [
                  ["", "All"],
                  ["outside", "Outside"],
                  ["inside", "Inside"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  onClick={() => {
                    setIr35(value);
                    resetPage();
                  }}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                    ir35 === value
                      ? value === "outside"
                        ? "bg-green-400/90 text-black"
                        : value === "inside"
                          ? "bg-green-400/90 text-black"
                          : "bg-slate-900 text-white"
                      : "text-slate-600 hover:text-slate-900"
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
              className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 [&>option]:bg-white"
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
              className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 [&>option]:bg-white"
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
              className="ml-auto rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 [&>option]:bg-white"
            >
              <option value="recent">Newest first</option>
              <option value="rate_high">Highest rate</option>
              <option value="rate_low">Lowest rate</option>
            </select>
          </div>
        </div>

        {/* Deep-link filter chips */}
        {(skillsLock.length > 0 || locationLock) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>Filtered by:</span>
            {skillsLock.map((skill) => (
              <button
                key={skill}
                onClick={() => {
                  setSkillsLock((prev) => prev.filter((s) => s !== skill));
                  resetPage();
                }}
                className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-slate-800 transition-colors hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                {skill} <X size={12} aria-label={`Remove ${skill} filter`} />
              </button>
            ))}
            {locationLock && (
              <button
                onClick={() => {
                  setLocationLock("");
                  resetPage();
                }}
                className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-slate-800 transition-colors hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                {locationLock} <X size={12} aria-label="Remove location filter" />
              </button>
            )}
          </div>
        )}

        {/* Result count */}
        <p className="mb-4 mt-6 flex items-center gap-2 text-sm text-slate-500" aria-live="polite">
          {loading ? (
            "Searching…"
          ) : data ? (
            <>
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
              </span>
              <span>
                <span className="font-medium text-slate-800">{data.total.toLocaleString()}</span> live
                contracts
              </span>
            </>
          ) : (
            ""
          )}
        </p>

        {/* Results */}
        {failed ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-slate-800">Couldn&apos;t load contracts.</p>
            <p className="mt-1 text-sm text-slate-500">Check your connection and refresh to try again.</p>
          </div>
        ) : loading && !data ? (
          <div className="flex items-center justify-center py-24 text-slate-500">
            <Loader2 className="animate-spin" size={22} />
          </div>
        ) : data && data.jobs.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-slate-800">No contracts match these filters.</p>
            <p className="mt-1 text-sm text-slate-500">
              Try clearing the rate filter or broadening your search terms.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {data?.jobs.map((job) => {
              const hasRate = job.rate_min !== null || job.rate_max !== null;
              return (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 pl-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 hover:shadow-[0_8px_40px_rgba(255,255,255,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:flex-row sm:items-start sm:justify-between"
                  >
                    {/* Status accent bar */}
                    <span
                      className={`absolute inset-y-0 left-0 w-[3px] ${STATUS_ACCENT[job.ir35_status]}`}
                      aria-hidden
                    />

                    <div className="min-w-0">
                      <h2 className="text-[15px] font-medium text-slate-900 sm:truncate">
                        {job.title}
                      </h2>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-500">
                        <span className="text-slate-700">{job.company_name}</span>
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
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
                          >
                            {skill}
                          </span>
                        ))}
                        {job.skills.length > 5 && (
                          <span className="text-xs text-slate-400">+{job.skills.length - 5}</span>
                        )}
                      </div>
                    </div>

                    {/* Rate rail — the signature */}
                    <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
                      {hasRate ? (
                        <span className="text-lg font-semibold tabular-nums tracking-tight sm:text-right">
                          {formatRate(job)}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-400 sm:text-right">
                          Rate on application
                        </span>
                      )}
                      <IR35Badge status={job.ir35_status} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {/* Pagination */}
        {data && data.total > data.per_page && (
          <nav className="mt-8 flex items-center justify-center gap-4" aria-label="Pagination">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              Previous
            </button>
            <span className="text-sm tabular-nums text-slate-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              Next
            </button>
          </nav>
        )}

        {/* Footer honesty line */}
        <footer className="mt-14 border-t border-slate-200/70 pt-6 text-center text-xs text-slate-400">
          Updated daily · Sources: employer career boards, Reed, Adzuna · IR35 status shown only when
          stated in the original listing
        </footer>
      </div>
    </main>
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
          <Loader2 className="animate-spin" size={22} />
        </main>
      }
    >
      <JobsBoard />
    </Suspense>
  );
}
