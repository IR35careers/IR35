"use client";

/**
 * /jobs — contract search with a left filter sidebar (facet counts), matching
 * the reference layout. Auth-gated. Deep-linkable filters.
 */

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, MapPin, Loader2, SlidersHorizontal, Bell, RefreshCw, ShieldCheck, Link2, WandSparkles, Activity } from "lucide-react";
import { formatFreshness, formatPosted, formatRate, ir35EvidenceLabel, type JobListing } from "@/lib/job-types";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { IR35Badge } from "@/components/ui/ir35-badge";

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
  data_source?: "live" | "demo";
  generated_at?: string;
  error?: string;
}

const RATE_OPTIONS = [0, 300, 400, 500, 600, 700] as const;
const RECENCY_OPTIONS = [[0, "Any time"], [1, "Last 24 hours"], [3, "Last 3 days"], [7, "Last week"], [14, "Last 2 weeks"]] as const;
const QUICK_SKILLS = ["React", "Python", "Java", ".NET", "AWS", "Azure", "DevOps", "Data Engineering", "Business Analysis", "Project Management", "Cyber Security", "Salesforce"] as const;

function RemoteTag({ type }: { type: JobListing["remote_type"] }) {
  if (type === "unknown") return null;
  const label = type === "remote" ? "Remote" : type === "hybrid" ? "Hybrid" : "On-site";
  return <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">{label}</span>;
}

function FilterOption({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`ir35-focus flex min-h-10 w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors ${active ? "bg-green-50 font-medium text-green-700" : "text-slate-600 hover:bg-slate-100"}`}
    >
      <span className="flex items-center gap-2">
        <span className={`flex h-4 w-4 items-center justify-center rounded border ${active ? "border-green-500 bg-green-500" : "border-slate-300"}`}>
          {active && <span className="text-[10px] text-white">✓</span>}
        </span>
        {label}
      </span>
      {count !== undefined && <span className="text-xs tabular-nums text-slate-500">{count}</span>}
    </button>
  );
}

function JobsBoard() {
  const searchParams = useSearchParams();
  const spIr35 = searchParams.get("ir35");
  const spRemote = searchParams.get("remote");
  const spMinRate = parseInt(searchParams.get("min_rate") ?? "", 10);

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [ir35, setIr35] = useState<"" | "outside" | "inside" | "tbc">(spIr35 === "outside" || spIr35 === "inside" || spIr35 === "tbc" || spIr35 === "unknown" ? (spIr35 === "unknown" ? "tbc" : spIr35) : "");
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
  const requestRef = useRef<AbortController | null>(null);
  const lastParamsRef = useRef(new URLSearchParams());
  const lastFacetKeyRef = useRef("");
  const facetCacheRef = useRef(new Map<string, Facets>());

  const runSearch = useCallback(async (params: URLSearchParams, facetKey: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true); setFailed(false);
    try {
      const res = await fetch(`/api/jobs/search?${params.toString()}`, { signal: controller.signal });
      const json = (await res.json()) as SearchResponse;
      if (!res.ok || json.error) throw new Error(json.error ?? "Search failed");
      if (requestRef.current !== controller) return;
      if (json.facets) facetCacheRef.current.set(facetKey, json.facets);
      setData({ ...json, facets: json.facets ?? facetCacheRef.current.get(facetKey) });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestRef.current === controller) setFailed(true);
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (ir35) params.set("ir35", ir35);
    if (remote) params.set("remote", remote);
    if (minRate > 0) params.set("min_rate", String(minRate));
    if (skillsLock.length > 0) params.set("skills", skillsLock.join(","));
    if (locationLock) params.set("location", locationLock);
    if (withinDays > 0) params.set("within_days", String(withinDays));
    if (sort !== "recent") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));
    const facetKey = JSON.stringify([q, minRate, skillsLock, locationLock, withinDays]);
    if (!facetCacheRef.current.has(facetKey)) params.set("with_facets", "1");
    lastParamsRef.current = params;
    lastFacetKeyRef.current = facetKey;
    const visibleParams = new URLSearchParams(params);
    visibleParams.delete("with_facets");
    const nextUrl = visibleParams.size > 0 ? `/jobs?${visibleParams.toString()}` : "/jobs";
    window.history.replaceState(window.history.state, "", nextUrl);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(params, facetKey), q ? 350 : 0);
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
      <PublicHeader />
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <div className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">UK contract search</p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-4xl">Find your next contract</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">Compare IR35 status, rate, location and working pattern before you open the original listing.</p>
        </div>

        {data?.data_source === "demo" && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            Preview data - connect Supabase to use live contract search locally.
          </p>
        )}

        <div className="grid overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-card sm:grid-cols-[1fr_0.55fr]">
          <label className="relative block">
            <span className="sr-only">Search contracts</span>
            <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => { setQ(e.target.value); resetPage(); }} placeholder="Role, skill or company"
              className="ir35-focus min-h-14 w-full border-0 bg-white pl-11 pr-4 text-sm placeholder:text-slate-500" aria-label="Search contracts" />
          </label>
          <label className="relative block border-t border-slate-200 sm:border-l sm:border-t-0">
            <span className="sr-only">Location</span>
            <MapPin size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" value={locationLock} onChange={(e) => { setLocationLock(e.target.value); resetPage(); }} placeholder="Town, region or UK"
              className="ir35-focus min-h-14 w-full border-0 bg-white pl-11 pr-4 text-sm placeholder:text-slate-500" aria-label="Filter by location" />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs font-medium text-emerald-950">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} aria-hidden="true" /> Explicit IR35 evidence labels</span>
          <span className="inline-flex items-center gap-1.5"><Link2 size={14} aria-hidden="true" /> Original source retained</span>
          <span>Daily source refresh and duplicate reduction</span>
          <Link href="/jobs/sources" className="ir35-focus ml-auto inline-flex items-center gap-1.5 rounded-md font-bold underline decoration-emerald-300 underline-offset-4 hover:text-brand-700"><Activity size={14} aria-hidden="true" /> View feed health</Link>
        </div>

        {/* Header row */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <div aria-live="polite">
            <p className="text-sm text-slate-500">
              {loading ? "Searching…" : data ? <><span className="font-semibold text-slate-800">{data.total.toLocaleString()}</span> contracts found</> : ""}
            </p>
            {!loading && data?.generated_at && <p className="mt-0.5 text-[11px] text-slate-400">Search refreshed {new Date(data.generated_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/analyse-job" className="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-green-300 hover:text-green-700 md:inline-flex">
              <WandSparkles size={13} /> Analyse a job URL
            </Link>
            <Link href={alertHref} className="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-green-300 hover:text-green-700 sm:inline-flex">
              <Bell size={13} /> Save as alert
            </Link>
            <select value={sort} onChange={(e) => { setSort(e.target.value); resetPage(); }} aria-label="Sort order" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 [&>option]:bg-white">
              <option value="recent">Newest first</option>
              <option value="rate_high">Highest day rate</option>
              <option value="rate_low">Lowest day rate</option>
            </select>
            <button onClick={() => setMobileFilters((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 lg:hidden">
              <SlidersHorizontal size={13} /> Filters
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* Sidebar (desktop) */}
          <aside className="hidden h-max rounded-2xl border border-slate-200 bg-white p-5 lg:sticky lg:top-24 lg:block">{Sidebar}</aside>
          {/* Sidebar (mobile) */}
          {mobileFilters && <aside className="rounded-2xl border border-slate-200 bg-white p-5 lg:hidden">{Sidebar}</aside>}

          {/* Results */}
          <div className={`min-w-0 transition-opacity ${loading && data ? "opacity-60" : "opacity-100"}`} aria-busy={loading}>
            {failed ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><p className="font-semibold text-slate-800">Couldn&apos;t load contracts.</p><p className="mt-1 text-sm text-slate-500">Your filters are still here. Retry the search when your connection is ready.</p><button type="button" onClick={() => void runSearch(lastParamsRef.current, lastFacetKeyRef.current)} className="ir35-focus mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"><RefreshCw size={15} aria-hidden="true" /> Retry search</button></div>
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
                      <Link href={`/jobs/${job.id}`} className="group relative grid gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 pl-6 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card lg:grid-cols-[minmax(0,1fr)_210px]">
                        <span className={`absolute inset-y-0 left-0 w-[3px] ${job.ir35_status === "outside" ? "bg-green-500" : job.ir35_status === "inside" ? "bg-rose-500" : "bg-slate-200"}`} aria-hidden />
                        <div className="min-w-0">
                          <h2 className="text-[15px] font-medium text-slate-900 sm:truncate">{job.title}</h2>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                            <span className="text-slate-700">{job.company_name}</span><span aria-hidden>·</span>
                            <span className="inline-flex items-center gap-1"><MapPin size={12} /> {job.location}</span><span aria-hidden>·</span>
                            <span>{formatPosted(job)}</span>
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <RemoteTag type={job.remote_type} />
                            {job.skills.slice(0, 5).map((s) => <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{s}</span>)}
                            {job.skills.length > 5 && <span className="text-xs text-slate-400">+{job.skills.length - 5}</span>}
                          </div>
                          <p className="mt-3 text-[11px] text-slate-400">{formatFreshness(job)}{job.source_domain ? ` · Source: ${job.source_domain.replace("www.", "")}` : ""}</p>
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 pt-3 lg:flex-col lg:items-end lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                          {hasRate ? <span className="text-lg font-semibold tabular-nums tracking-tight sm:text-right">{formatRate(job)}</span> : <span className="text-sm text-slate-400 sm:text-right">Rate on application</span>}
                          <IR35Badge status={job.ir35_status} />
                          <span className="text-[11px] text-slate-400 sm:text-right">{ir35EvidenceLabel(job)}</span>
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
      <PublicFooter />
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
