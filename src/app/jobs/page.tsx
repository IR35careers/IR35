"use client";

/**
 * /jobs — contract search with a left filter sidebar (facet counts), matching
 * the reference layout. Auth-gated. Deep-linkable filters.
 */

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, Bell, BriefcaseBusiness, Check, Clock3, LayoutGrid, MapPin, PoundSterling, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { formatPosted, formatRate, type JobListing } from "@/lib/job-types";
import {
  isRateTypeFilter,
  isSeniorityFilter,
  RATE_TYPE_FILTER_OPTIONS,
  SENIORITY_FILTER_OPTIONS,
  type RateTypeFilter,
  type SeniorityFilter,
} from "@/lib/job-search-filters";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { IR35Badge } from "@/components/ui/ir35-badge";
import { CompanyLogo } from "@/components/ui/company-logo";
import { JobCardSkeleton, StatePanel } from "@/components/ui/state-panel";
import { useAuth } from "@/lib/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { isAdministratorEmail } from "@/lib/portal-access";

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
const JOBS_PER_PAGE = 12;
const JOB_CARD_TONES = [
  "from-emerald-50 via-white to-cyan-50/80 border-emerald-100",
  "from-cyan-50 via-white to-sky-50/80 border-cyan-100",
  "from-amber-50 via-white to-orange-50/70 border-amber-100",
  "from-violet-50 via-white to-fuchsia-50/60 border-violet-100",
] as const;

function RemoteTag({ type }: { type: JobListing["remote_type"] }) {
  if (type === "unknown") return null;
  const label = type === "remote" ? "Remote" : type === "hybrid" ? "Hybrid" : "On-site";
  return <span className="rounded-full border border-white/80 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm">{label}</span>;
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
      className={`ir35-focus flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-all ${active ? "bg-emerald-50 font-semibold text-emerald-800 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.16)]" : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-950"}`}
    >
      <span className="flex items-center gap-2">
        <span className={`flex h-4 w-4 items-center justify-center rounded border ${active ? "border-emerald-600 bg-emerald-600" : "border-slate-300 bg-white"}`}>
          {active && <Check size={11} className="text-white" strokeWidth={3} />}
        </span>
        {label}
      </span>
      {count !== undefined && <span className="text-xs tabular-nums text-slate-500">{count}</span>}
    </button>
  );
}

function JobsBoard() {
  const { user, loading: authLoading } = useAuth();
  const memberView =
    !isSupabaseConfigured() ||
    (!authLoading && Boolean(user) && !isAdministratorEmail(user?.email));
  const searchParams = useSearchParams();
  const spIr35 = searchParams.get("ir35");
  const spRemote = searchParams.get("remote");
  const spMinRate = parseInt(searchParams.get("min_rate") ?? "", 10);
  const spSeniority = searchParams.get("seniority") ?? "";
  const spRateType = searchParams.get("rate_type") ?? "";

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [ir35, setIr35] = useState<"" | "outside" | "inside" | "tbc">(spIr35 === "outside" || spIr35 === "inside" || spIr35 === "tbc" || spIr35 === "unknown" ? (spIr35 === "unknown" ? "tbc" : spIr35) : "");
  const [remote, setRemote] = useState(spRemote === "remote" || spRemote === "hybrid" || spRemote === "onsite" ? spRemote : "");
  const [minRate, setMinRate] = useState(Number.isFinite(spMinRate) && spMinRate > 0 ? spMinRate : 0);
  const [sort, setSort] = useState("recent");
  const [withinDays, setWithinDays] = useState(0);
  const [seniority, setSeniority] = useState<"" | SeniorityFilter>(isSeniorityFilter(spSeniority) ? spSeniority : "");
  const [rateType, setRateType] = useState<"" | RateTypeFilter>(isRateTypeFilter(spRateType) ? spRateType : "");
  const [sponsorship, setSponsorship] = useState(searchParams.get("sponsorship") === "stated");
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
      const baseParams = new URLSearchParams(params);
      baseParams.delete("with_facets");
      const cachedFacets = facetCacheRef.current.get(facetKey);
      const res = await fetch(`/api/jobs/search?${baseParams.toString()}`, { signal: controller.signal });
      const json = (await res.json()) as SearchResponse;
      if (!res.ok || json.error) throw new Error(json.error ?? "Search failed");
      if (requestRef.current !== controller) return;
      setData({ ...json, facets: cachedFacets });

      if (!cachedFacets) {
        const facetParams = new URLSearchParams(baseParams);
        facetParams.set("with_facets", "1");
        facetParams.set("per_page", "1");
        void fetch(`/api/jobs/search?${facetParams.toString()}`, { signal: controller.signal })
          .then(async (facetResponse) => {
            const facetJson = (await facetResponse.json()) as SearchResponse;
            if (!facetResponse.ok || facetJson.error || !facetJson.facets) return;
            if (requestRef.current !== controller) return;
            facetCacheRef.current.set(facetKey, facetJson.facets);
            setData((current) => current ? { ...current, facets: facetJson.facets } : current);
          })
          .catch(() => undefined);
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestRef.current === controller) setFailed(true);
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (!mobileFilters) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileFilters(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileFilters]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (ir35) params.set("ir35", ir35);
    if (remote) params.set("remote", remote);
    if (minRate > 0) params.set("min_rate", String(minRate));
    if (skillsLock.length > 0) params.set("skills", skillsLock.join(","));
    if (locationLock) params.set("location", locationLock);
    if (withinDays > 0) params.set("within_days", String(withinDays));
    if (seniority) params.set("seniority", seniority);
    if (rateType) params.set("rate_type", rateType);
    if (sponsorship) params.set("sponsorship", "stated");
    if (sort !== "recent") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));
    params.set("per_page", String(JOBS_PER_PAGE));
    const facetKey = JSON.stringify([q, minRate, skillsLock, locationLock, withinDays, seniority, rateType, sponsorship]);
    lastParamsRef.current = params;
    lastFacetKeyRef.current = facetKey;
    const visibleParams = new URLSearchParams(params);
    visibleParams.delete("with_facets");
    visibleParams.delete("per_page");
    const nextUrl = visibleParams.size > 0 ? `/jobs?${visibleParams.toString()}` : "/jobs";
    window.history.replaceState(window.history.state, "", nextUrl);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(params, facetKey), q ? 350 : 0);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, ir35, remote, minRate, skillsLock, locationLock, sort, withinDays, seniority, rateType, sponsorship, page, runSearch]);

  const resetPage = () => setPage(1);
  const clearFilters = () => {
    setQ("");
    setIr35("");
    setRemote("");
    setMinRate(0);
    setWithinDays(0);
    setSeniority("");
    setRateType("");
    setSponsorship(false);
    setSkillsLock([]);
    setLocationLock("");
    setPage(1);
  };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  const f = data?.facets;
  const activeFilterCount = [
    ir35,
    remote,
    minRate > 0,
    withinDays > 0,
    seniority,
    rateType,
    sponsorship,
    skillsLock.length > 0,
    locationLock,
  ].filter(Boolean).length;

  const alertHref = (() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (ir35 && ir35 !== "tbc") p.set("ir35", ir35);
    if (remote) p.set("remote", remote);
    if (minRate > 0) p.set("min_rate", String(minRate));
    if (skillsLock.length) p.set("skills", skillsLock.join(","));
    if (seniority) p.set("seniority", seniority);
    if (rateType) p.set("rate_type", rateType);
    if (sponsorship) p.set("sponsorship", "stated");
    p.set("prefill", "1");
    return `/alerts?${p.toString()}`;
  })();

  const Sidebar = (
    <div className="space-y-5">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">IR35 status</p>
        <div className="space-y-0.5">
          <FilterOption label="Outside IR35" count={f?.outside} active={ir35 === "outside"} onClick={() => { setIr35(ir35 === "outside" ? "" : "outside"); resetPage(); }} />
          <FilterOption label="Inside IR35" count={f?.inside} active={ir35 === "inside"} onClick={() => { setIr35(ir35 === "inside" ? "" : "inside"); resetPage(); }} />
          <FilterOption label="TBC" count={f?.tbc} active={ir35 === "tbc"} onClick={() => { setIr35(ir35 === "tbc" ? "" : "tbc"); resetPage(); }} />
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Workplace</p>
        <div className="space-y-0.5">
          <FilterOption label="Remote" count={f?.remote} active={remote === "remote"} onClick={() => { setRemote(remote === "remote" ? "" : "remote"); resetPage(); }} />
          <FilterOption label="Hybrid" count={f?.hybrid} active={remote === "hybrid"} onClick={() => { setRemote(remote === "hybrid" ? "" : "hybrid"); resetPage(); }} />
          <FilterOption label="On-site" count={f?.onsite} active={remote === "onsite"} onClick={() => { setRemote(remote === "onsite" ? "" : "onsite"); resetPage(); }} />
        </div>
      </div>
      <div>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">Seniority</span>
        <select value={seniority} onChange={(event) => { const value = event.target.value; setSeniority(isSeniorityFilter(value) ? value : ""); resetPage(); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 [&>option]:bg-white">
          <option value="">Any seniority</option>
          {SENIORITY_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
      </div>
      <div>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">Rate basis</span>
        <select value={rateType} onChange={(event) => { const value = event.target.value; const next = isRateTypeFilter(value) ? value : ""; setRateType(next); if (next && next !== "daily") setMinRate(0); resetPage(); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 [&>option]:bg-white">
          <option value="">Any rate basis</option>
          {RATE_TYPE_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Minimum day rate</p>
        <select aria-label="Minimum day rate" value={minRate} disabled={Boolean(rateType && rateType !== "daily")} onChange={(e) => { const value = Number(e.target.value); setMinRate(value); if (value > 0) setRateType("daily"); resetPage(); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 [&>option]:bg-white">
          {RATE_OPTIONS.map((r) => <option key={r} value={r}>{r === 0 ? "Any rate" : `£${r}+/day`}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Posted within</p>
        <select aria-label="Posted within" value={withinDays} onChange={(e) => { setWithinDays(Number(e.target.value)); resetPage(); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 [&>option]:bg-white">
          {RECENCY_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Skills</p>
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
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Eligibility evidence</p>
        <FilterOption label="Sponsorship explicitly offered" active={sponsorship} onClick={() => { setSponsorship((value) => !value); resetPage(); }} />
        <p className="mt-1.5 text-[11px] leading-4 text-slate-600">Matches positive wording in the listing. Unknown does not mean unavailable.</p>
      </div>
      {(ir35 || remote || minRate > 0 || withinDays > 0 || seniority || rateType || sponsorship || skillsLock.length > 0 || locationLock) && (
        <button onClick={clearFilters} className="text-sm font-medium text-green-700 hover:underline">
          Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <div className="ir35-workspace-canvas min-h-screen text-slate-900">
      <PublicHeader hideForWorkspaceMembers />
      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7">
        <section className="relative overflow-hidden rounded-[28px] border border-slate-800/70 bg-[#041922] text-white shadow-[0_30px_80px_-45px_rgba(2,44,50,0.9)]">
          <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 left-[28%] h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-end lg:p-8">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300"><Sparkles size={14} /> UK contract search</div>
              <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-[1.06] tracking-[-0.045em] sm:text-[2.7rem]">Find your next contract</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">Compare live UK contracts by IR35 status, rate and working pattern, then open the roles that deserve your time.</p>
              <div className="mt-6 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(230px,0.55fr)]">
                <label className="relative block">
                  <span className="sr-only">Search contracts</span>
                  <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input type="search" value={q} onChange={(e) => { setQ(e.target.value); resetPage(); }} placeholder="Role, skill or company" className="ir35-focus min-h-[54px] w-full rounded-2xl border border-white/15 bg-white/[0.10] pl-11 pr-4 text-sm text-white shadow-inner backdrop-blur placeholder:text-slate-400 focus:bg-white/[0.14]" aria-label="Search contracts" />
                </label>
                <label className="relative block">
                  <span className="sr-only">Location</span>
                  <MapPin size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input type="search" value={locationLock} onChange={(e) => { setLocationLock(e.target.value); resetPage(); }} placeholder="Town, region or UK" className="ir35-focus min-h-[54px] w-full rounded-2xl border border-white/15 bg-white/[0.10] pl-11 pr-4 text-sm text-white shadow-inner backdrop-blur placeholder:text-slate-400 focus:bg-white/[0.14]" aria-label="Filter by location" />
                </label>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Live contracts", value: data?.total ?? "—", icon: BriefcaseBusiness },
                { label: "Outside IR35", value: f?.outside ?? "—", icon: ShieldCheck },
                { label: "Remote", value: f?.remote ?? "—", icon: MapPin },
              ].map((stat) => <div key={stat.label} className="rounded-2xl border border-white/12 bg-white/[0.08] p-3 backdrop-blur sm:p-4"><stat.icon size={16} className="text-emerald-300" /><p className="mt-3 text-xl font-semibold tabular-nums tracking-[-0.04em] sm:text-2xl">{typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}</p><p className="mt-1 text-[10px] font-semibold leading-4 text-slate-200 sm:text-[11px]">{stat.label}</p></div>)}
            </div>
          </div>
        </section>

        {data?.data_source === "demo" && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">Preview roles are shown in this local workspace.</p>}

        <section className="ir35-card ir35-aurora-panel relative z-10 -mt-1 rounded-[24px] p-3 shadow-[0_22px_55px_-38px_rgba(15,23,42,0.45)] sm:mx-4 sm:p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2" aria-label="Popular contract filters">
              <button type="button" aria-pressed={ir35 === "outside"} onClick={() => { setIr35(ir35 === "outside" ? "" : "outside"); resetPage(); }} className={`ir35-focus min-h-10 rounded-xl px-3.5 text-xs font-semibold transition ${ir35 === "outside" ? "bg-emerald-700 text-white shadow-sm" : "bg-white/80 text-slate-700 hover:bg-emerald-50"}`}>Outside IR35</button>
              <button type="button" aria-pressed={remote === "remote"} onClick={() => { setRemote(remote === "remote" ? "" : "remote"); resetPage(); }} className={`ir35-focus min-h-10 rounded-xl px-3.5 text-xs font-semibold transition ${remote === "remote" ? "bg-cyan-700 text-white shadow-sm" : "bg-white/80 text-slate-700 hover:bg-cyan-50"}`}>Remote</button>
              <button type="button" aria-pressed={minRate === 600} onClick={() => { setMinRate(minRate === 600 ? 0 : 600); setRateType(minRate === 600 ? "" : "daily"); resetPage(); }} className={`ir35-focus min-h-10 rounded-xl px-3.5 text-xs font-semibold transition ${minRate === 600 ? "bg-slate-950 text-white shadow-sm" : "bg-white/80 text-slate-700 hover:bg-amber-50"}`}>£600+ per day</button>
              {activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="ir35-focus min-h-10 rounded-xl px-3.5 text-xs font-semibold text-brand-800 hover:bg-brand-50">Clear {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}</button>}
            </div>
            <div className="flex items-center gap-2">
              <Link href={alertHref} className="ir35-focus hidden min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-800 sm:inline-flex"><Bell size={14} /> Save search</Link>
              <select value={sort} onChange={(e) => { setSort(e.target.value); resetPage(); }} aria-label="Sort order" className="ir35-focus min-h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 sm:flex-none [&>option]:bg-white"><option value="recent">Newest first</option><option value="rate_high">Highest day rate</option><option value="rate_low">Lowest day rate</option></select>
              <button onClick={() => setMobileFilters(true)} aria-expanded={mobileFilters} className="ir35-focus inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-slate-950 px-3.5 text-xs font-semibold text-white lg:hidden"><SlidersHorizontal size={14} /> Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}</button>
            </div>
          </div>
        </section>

        <div className="mt-6 flex flex-col gap-2 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div aria-live="polite"><p className="text-sm text-slate-600">{loading ? "Searching…" : data ? <><span className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">{data.total.toLocaleString()}</span> contracts found</> : ""}</p>{!loading && data?.generated_at && <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Clock3 size={12} /> Updated {new Date(data.generated_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>}</div>
          <p className="flex items-center gap-2 text-xs font-medium text-slate-500"><LayoutGrid size={14} className="text-brand-600" /> Clear comparisons, no hidden redirects</p>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[278px_minmax(0,1fr)]">
          <aside className="ir35-card ir35-aurora-panel hidden h-max overflow-hidden lg:sticky lg:top-24 lg:block"><div className="border-b border-slate-200/80 bg-gradient-to-r from-emerald-50/80 to-cyan-50/60 px-5 py-4"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-700">Contract filters</p><h2 className="mt-1 font-semibold text-slate-950">Refine results</h2></div><SlidersHorizontal size={18} className="text-brand-700" /></div></div><div className="p-4">{Sidebar}</div></aside>

          {mobileFilters && <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true" aria-label="Contract filters"><button type="button" aria-label="Close filters" onClick={() => setMobileFilters(false)} className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" /><aside className="absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-y-auto rounded-t-[28px] bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-700">Contract filters</p><h2 className="mt-1 text-lg font-semibold text-slate-950">Refine results</h2></div><button type="button" aria-label="Close contract filters" onClick={() => setMobileFilters(false)} className="ir35-focus flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600"><X size={19} /></button></div><div className="p-5">{Sidebar}</div><div className="sticky bottom-0 z-20 flex gap-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur"><button type="button" onClick={clearFilters} className="ir35-focus min-h-12 flex-1 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700">Clear all</button><button type="button" onClick={() => setMobileFilters(false)} className="ir35-focus min-h-12 flex-[1.4] rounded-xl bg-emerald-700 text-sm font-bold text-white">Show {data?.total.toLocaleString() ?? ""} contracts</button></div></aside></div>}

          <div className={`min-w-0 transition-opacity ${loading && data ? "opacity-60" : "opacity-100"}`} aria-busy={loading}>
            {failed ? <StatePanel kind="error" title="Couldn&apos;t load contracts" body="Your filters are still here. Retry the search when your connection is ready." action={<button type="button" onClick={() => void runSearch(lastParamsRef.current, lastFacetKeyRef.current)} className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"><RefreshCw size={15} aria-hidden="true" /> Retry search</button>} />
            : loading && !data ? <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Loading contracts"><span className="sr-only">Loading contracts</span>{Array.from({ length: 6 }, (_, index) => <JobCardSkeleton key={index} />)}</div>
            : data && data.jobs.length === 0 ? <StatePanel title="No contracts match these filters" body="Try clearing a filter or broadening your search." action={<button type="button" onClick={clearFilters} className="ir35-focus inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700">Clear filters</button>} />
            : <ul className="ir35-job-results grid gap-4 md:grid-cols-2">
              {data?.jobs.map((job, index) => {
                const hasRate = job.rate_min !== null || job.rate_max !== null;
                const companyName = job.company_name.trim() || "Company not shown";
                return <li key={job.id} className="min-w-0"><Link href={`/jobs/${job.id}`} className={`group relative flex h-full min-h-[248px] flex-col overflow-hidden rounded-[22px] border bg-gradient-to-br p-5 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.48)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_25px_55px_-30px_rgba(15,23,42,0.34)] ${JOB_CARD_TONES[index % JOB_CARD_TONES.length]}`}>
                  <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/60 blur-2xl" />
                  <div className="relative flex items-start justify-between gap-3"><CompanyLogo companyName={companyName} /><IR35Badge status={job.ir35_status} /></div>
                  <div className="relative mt-5 min-w-0 flex-1"><h2 className="line-clamp-2 text-lg font-semibold leading-6 tracking-[-0.025em] text-slate-950 transition-colors group-hover:text-brand-800">{job.title}</h2><p className="mt-2 truncate text-sm font-medium text-slate-700">{companyName}</p><p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><MapPin size={12} />{job.location || "UK"}</span><span aria-hidden>·</span><span>{formatPosted(job)}</span></p><div className="mt-4 flex flex-wrap items-center gap-1.5"><RemoteTag type={job.remote_type} />{job.skills.slice(0, 3).map((skill) => <span key={skill} className="rounded-full border border-white/80 bg-white/75 px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm">{skill}</span>)}{job.skills.length > 3 && <span className="px-1 text-[11px] font-medium text-slate-500">+{job.skills.length - 3}</span>}</div></div>
                  <div className="relative mt-5 flex items-end justify-between gap-3 border-t border-slate-900/[0.07] pt-4"><div><p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500"><PoundSterling size={11} /> Contract rate</p>{hasRate ? <span className="mt-1 block text-base font-semibold tabular-nums tracking-[-0.02em] text-slate-950">{formatRate(job)}</span> : <span className="mt-1 block text-sm font-semibold text-slate-700">Rate on application</span>}</div><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white transition group-hover:bg-emerald-700"><ArrowUpRight size={17} /></span></div>
                </Link></li>;
              })}
            </ul>}

            {data && data.total > data.per_page && <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination"><button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Previous</button><span className="rounded-xl bg-white/70 px-3 py-2 text-sm tabular-nums text-slate-500">Page <strong className="text-slate-900">{page}</strong> of {totalPages}</span><button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="ir35-focus inline-flex min-h-11 items-center gap-1 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40">Next <ArrowRight size={14} /></button></nav>}
          </div>
        </div>
      </main>
      {!memberView && <PublicFooter />}
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<JobsPageSkeleton />}>
      <JobsBoard />
    </Suspense>
  );
}

function JobsPageSkeleton() {
  return (
    <div className="ir35-workspace-canvas min-h-screen text-slate-900" aria-busy="true">
      <PublicHeader />
      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7">
        <section className="relative overflow-hidden rounded-[28px] border border-slate-800/70 bg-[#041922] p-5 text-white sm:p-8">
          <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="relative animate-pulse">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">UK contract search</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Find your next contract</h1>
            <div className="mt-6 h-14 max-w-3xl rounded-2xl border border-white/10 bg-white/10" aria-hidden="true" />
          </div>
        </section>
        <div className="ir35-card ir35-aurora-panel mx-0 -mt-1 h-16 animate-pulse rounded-[24px] sm:mx-4" aria-hidden="true" />
        <div className="mt-10 grid gap-5 lg:grid-cols-[278px_minmax(0,1fr)]"><div className="hidden h-[520px] animate-pulse rounded-[22px] border border-slate-200 bg-white lg:block" aria-hidden="true" /><div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Loading contracts"><span className="sr-only">Loading contracts</span>{Array.from({ length: 6 }, (_, index) => <JobCardSkeleton key={index} />)}</div></div>
      </main>
      <PublicFooter />
    </div>
  );
}
