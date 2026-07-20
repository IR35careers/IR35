"use client";

/**
 * /jobs — contract search with a left filter sidebar (facet counts), matching
 * the reference layout. Auth-gated. Deep-linkable filters.
 */

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, MapPin, Loader2, SlidersHorizontal, Bell } from "lucide-react";
import { formatPosted, formatRate, type JobListing } from "@/lib/job-types";
import { useAuth } from "@/lib/auth-context";
import { AppNav } from "@/components/AppNav";

interface Facets {
  outside: number; inside: number; tbc: number;
  remote: number; hybrid: number; onsite: number;
}
interface SearchResponse {
  jobs: JobListing[];
  total: number;
  facets?: Facets;
  page: number;
  per_page: number;
  error?: string;
}

const RATE_OPTIONS = [0, 300, 400, 500, 600, 700] as const;
const RECENCY_OPTIONS = [[0, "Any time"], [1, "Last 24 hours"], [3, "Last 3 days"], [7, "Last week"], [14, "Last 2 weeks"]] as const;
const QUICK_SKILLS = ["React", "Python", "Java", ".NET", "AWS", "Azure", "DevOps", "Data Engineering", "Business Analysis", "Project Management", "Cyber Security", "Salesforce"] as const;

function IR35Badge({ status }: { status: JobListing["ir35_status"] }) {
  if (status === "outside") return <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">Outside IR35</span>;
  if (status === "inside") return <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-600">Inside IR35</span>;
  return <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-500">IR35: TBC</span>;
}
function RemoteTag({ type }: { type: JobListing["remote_type"] }) {
  if (type === "unknown") return null;
  const label = type === "remote" ? "Remote" : type === "hybrid" ? "Hybrid" : "On-site";
  return <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">{label}</span>;
}

function JobsBoard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const spIr35 = searchParams.get("ir35");
  const spRemote = searchParams.get("remote");
  const spMinRate = parseInt(searchParams.get("min_rate") ?? "", 10);

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [ir35, setIr35] = useState<"" | "outside" | "inside" | "tbc">(spIr35 === "outside" || spIr35 === "inside" ? spIr35 : "");
  const [remote, setRemote] = useState(spRemote === "remote" || spRemote === "hybrid" || spRemote === "onsite" ? spRemote : "");
  const [minRate, setMinRate] = useState(Number.isFinite(spMinRate) && spMinRate > 0 ? spMinRate : 0);
  const [sort, setSort] = useState("recent");
  const [withinDays, setWithinDays] = useState(0);
  const [page, setPage] = useState(1);
  const [skillsLock, setSkillsLock] = useState<string[]>((searchParams.get("skills") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const [locationLock, setLocationLock] = useState(searchParams.get("location") ?? "");
  const [mobileFilters, setMobileFilters] = useState(false);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      const target = `${window.location.pathname}${window.location.search}`;
      router.replace(`/account?next=${encodeURIComponent(target)}`);
    }
  }, [user, authLoading, router]);

  const runSearch = useCallback(async (params: URLSearchParams) => {
    setLoading(true); setFailed(false);
    try {
      const res = await fetch(`/api/jobs/search?${params.toString()}`);
      const json = (await res.json()) as SearchResponse;
      if (!res.ok || json.error) throw new Error(json.error ?? "Search failed");
      setData(json);
    } catch { setFailed(true); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (ir35) params.set("ir35", ir35 === "tbc" ? "" : ir35);
    if (remote) params.set("remote", remote);
    if (minRate > 0) params.set("min_rate", String(minRate));
    if (skillsLock.length > 0) params.set("skills", skillsLock.join(","));
    if (locationLock) params.set("location", locationLock);
    if (withinDays > 0) params.set("within_days", String(withinDays));
    if (sort !== "recent") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));
    params.set("with_facets", "1");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(params), q ? 350 : 0);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, ir35, remote, minRate, skillsLock, locationLock, sort, withinDays, page, runSearch]);

  const resetPage = () => setPage(1);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  const f = data?.facets;

  const alertHref = (() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (ir35 && ir35 !== "tbc") p.set("ir35", ir35);
    if (remote) p.set("remote", remote);
    if (minRate > 0) p.set("min_rate", String(minRate));
    if (skillsLock.length) p.set("skills", skillsLock.join(","));
    p.set("prefill", "1");
    return `/alerts?${p.toString()}`;
  })();

  if (authLoading || !user) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500"><Loader2 className="animate-spin" size={22} /></main>;
  }

  const FilterOption = ({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) => (
    <button onClick={onClick} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors ${active ? "bg-green-50 font-medium text-green-700" : "text-slate-600 hover:bg-slate-100"}`}>
      <span className="flex items-center gap-2">
        <span className={`flex h-4 w-4 items-center justify-center rounded border ${active ? "border-green-500 bg-green-500" : "border-slate-300"}`}>
          {active && <span className="text-[10px] text-white">✓</span>}
        </span>
        {label}
      </span>
      {count !== undefined && <span className="text-xs tabular-nums text-slate-400">{count}</span>}
    </button>
  );

  const Sidebar = (
    <div className="space-y-5">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">IR35 status</p>
        <div className="space-y-0.5">
          <FilterOption label="Outside IR35" count={f?.outside} active={ir35 === "outside"} onClick={() => { setIr35(ir35 === "outside" ? "" : "outside"); resetPage(); }} />
          <FilterOption label="Inside IR35" count={f?.inside} active={ir35 === "inside"} onClick={() => { setIr35(ir35 === "inside" ? "" : "inside"); resetPage(); }} />
          <FilterOption label="TBC" count={f?.tbc} active={ir35 === "tbc"} onClick={() => { setIr35(ir35 === "tbc" ? "" : "tbc"); resetPage(); }} />
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Workplace</p>
        <div className="space-y-0.5">
          <FilterOption label="Remote" count={f?.remote} active={remote === "remote"} onClick={() => { setRemote(remote === "remote" ? "" : "remote"); resetPage(); }} />
          <FilterOption label="Hybrid" count={f?.hybrid} active={remote === "hybrid"} onClick={() => { setRemote(remote === "hybrid" ? "" : "hybrid"); resetPage(); }} />
          <FilterOption label="On-site" count={f?.onsite} active={remote === "onsite"} onClick={() => { setRemote(remote === "onsite" ? "" : "onsite"); resetPage(); }} />
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Minimum day rate</p>
        <select value={minRate} onChange={(e) => { setMinRate(Number(e.target.value)); resetPage(); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 [&>option]:bg-white">
          {RATE_OPTIONS.map((r) => <option key={r} value={r}>{r === 0 ? "Any rate" : `£${r}+/day`}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Posted within</p>
        <select value={withinDays} onChange={(e) => { setWithinDays(Number(e.target.value)); resetPage(); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 [&>option]:bg-white">
          {RECENCY_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Skills</p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_SKILLS.map((skill) => {
            const active = skillsLock.includes(skill);
            return (
              <button key={skill} onClick={() => { setSkillsLock((prev) => active ? prev.filter((s) => s !== skill) : [...prev, skill]); resetPage(); }}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? "border-green-300 bg-green-50 text-green-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
                {skill}
              </button>
            );
          })}
        </div>
      </div>
      {(ir35 || remote || minRate > 0 || withinDays > 0 || skillsLock.length > 0 || locationLock) && (
        <button onClick={() => { setIr35(""); setRemote(""); setMinRate(0); setWithinDays(0); setSkillsLock([]); setLocationLock(""); resetPage(); }} className="text-sm font-medium text-green-700 hover:underline">
          Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav />
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {/* Search bar */}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); resetPage(); }} placeholder="Search roles, skills, companies…"
            className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40" aria-label="Search contracts" />
        </div>

        {/* Header row */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500" aria-live="polite">
            {loading ? "Searching…" : data ? <><span className="font-semibold text-slate-800">{data.total.toLocaleString()}</span> contracts found</> : ""}
          </p>
          <div className="flex items-center gap-2">
            <Link href={alertHref} className="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-green-300 hover:text-green-700 sm:inline-flex">
              <Bell size={13} /> Save as alert
            </Link>
            <select value={sort} onChange={(e) => { setSort(e.target.value); resetPage(); }} aria-label="Sort order" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 [&>option]:bg-white">
              <option value="recent">Newest first</option>
              <option value="rate_high">Highest rate</option>
              <option value="rate_low">Lowest rate</option>
            </select>
            <button onClick={() => setMobileFilters((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 lg:hidden">
              <SlidersHorizontal size={13} /> Filters
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* Sidebar (desktop) */}
          <aside className="hidden h-max rounded-2xl border border-slate-200 bg-white p-5 lg:block">{Sidebar}</aside>
          {/* Sidebar (mobile) */}
          {mobileFilters && <aside className="rounded-2xl border border-slate-200 bg-white p-5 lg:hidden">{Sidebar}</aside>}

          {/* Results */}
          <div className="min-w-0">
            {failed ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><p className="text-slate-700">Couldn&apos;t load contracts.</p><p className="mt-1 text-sm text-slate-500">Refresh to try again.</p></div>
            ) : loading && !data ? (
              <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="animate-spin" size={22} /></div>
            ) : data && data.jobs.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><p className="text-slate-700">No contracts match these filters.</p><p className="mt-1 text-sm text-slate-500">Try clearing a filter or broadening your search.</p></div>
            ) : (
              <ul className="space-y-3">
                {data?.jobs.map((job) => {
                  const hasRate = job.rate_min !== null || job.rate_max !== null;
                  return (
                    <li key={job.id}>
                      <Link href={`/jobs/${job.id}`} className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 pl-6 transition-all hover:-translate-y-0.5 hover:border-green-300 hover:shadow-sm sm:flex-row sm:items-start sm:justify-between">
                        <span className={`absolute inset-y-0 left-0 w-[3px] ${job.ir35_status === "outside" ? "bg-green-500" : job.ir35_status === "inside" ? "bg-rose-500" : "bg-slate-200"}`} aria-hidden />
                        <div className="min-w-0">
                          <h2 className="text-[15px] font-medium text-slate-900 sm:truncate">{job.title}</h2>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
                            <span className="text-slate-700">{job.company_name}</span><span aria-hidden>·</span>
                            <span className="inline-flex items-center gap-1"><MapPin size={12} /> {job.location}</span><span aria-hidden>·</span>
                            <span>{formatPosted(job)}</span>
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <RemoteTag type={job.remote_type} />
                            {job.skills.slice(0, 5).map((s) => <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{s}</span>)}
                            {job.skills.length > 5 && <span className="text-xs text-slate-400">+{job.skills.length - 5}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
                          {hasRate ? <span className="text-lg font-semibold tabular-nums tracking-tight sm:text-right">{formatRate(job)}</span> : <span className="text-sm text-slate-400 sm:text-right">Rate on application</span>}
                          <IR35Badge status={job.ir35_status} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {data && data.total > data.per_page && (
              <nav className="mt-8 flex items-center justify-center gap-4" aria-label="Pagination">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40">Previous</button>
                <span className="text-sm tabular-nums text-slate-500">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40">Next</button>
              </nav>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500"><Loader2 className="animate-spin" size={22} /></main>}>
      <JobsBoard />
    </Suspense>
  );
}
