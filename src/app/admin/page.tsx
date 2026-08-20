"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  Database,
  ExternalLink,
  FileCheck2,
  Gauge,
  Home,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

type Section = "stats" | "jobs" | "users" | "waitlist" | "runs";

type JobRow = {
  id: string;
  title: string;
  company_name: string | null;
  location?: string | null;
  ir35_status: string | null;
  rate_min?: number | null;
  rate_max?: number | null;
  rate_type?: string | null;
  source_domain: string | null;
  posted_at?: string | null;
  first_seen_at: string;
  expired_at?: string | null;
};

type UserRow = {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string | null;
  provider?: string;
  profile?: {
    full_name?: string | null;
    skills?: string[] | null;
    cv_filename?: string | null;
  } | null;
};

type RunRow = {
  run_type: string;
  summary: Record<string, unknown> | null;
  created_at: string;
};

type AdminData = {
  totalUsers?: number | null;
  profiles?: number;
  cvsUploaded?: number;
  waitlist?: Array<{ email: string; created_at: string }> | number;
  liveJobs?: number;
  expiredJobs?: number;
  ir35Breakdown?: { outside?: number; inside?: number; tbc?: number };
  topSources?: Array<{ source: string; count: number }>;
  recentJobs?: JobRow[];
  recentUsers?: UserRow[];
  recentRuns?: RunRow[];
  lastPipelineRun?: RunRow | null;
  users?: UserRow[];
  total?: number;
  jobs?: JobRow[];
  runs?: RunRow[];
};

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ id: Section; label: string; icon: typeof Users }>;
}> = [
  {
    label: "Workspace",
    items: [
      { id: "stats", label: "Dashboard", icon: LayoutDashboard },
      { id: "jobs", label: "Job inventory", icon: BriefcaseBusiness },
      { id: "users", label: "Contractors", icon: Users },
    ],
  },
  {
    label: "Communications",
    items: [{ id: "waitlist", label: "Launch audience", icon: Mail }],
  },
  {
    label: "System",
    items: [{ id: "runs", label: "Pipeline runs", icon: Activity }],
  },
];

const SECTION_COPY: Record<Section, { eyebrow: string; title: string; description: string }> = {
  stats: {
    eyebrow: "Operations centre",
    title: "Business dashboard",
    description: "Monitor contractor growth, job quality and the health of your ingestion pipeline.",
  },
  jobs: {
    eyebrow: "Content operations",
    title: "Job inventory",
    description: "Review the latest roles, IR35 coverage and listings that need moderation.",
  },
  users: {
    eyebrow: "Audience",
    title: "Contractors",
    description: "Understand registrations, profile readiness and CV adoption.",
  },
  waitlist: {
    eyebrow: "One-time notice",
    title: "Launch audience",
    description: "Review the former waitlist retained only for the approved public-access announcement.",
  },
  runs: {
    eyebrow: "System health",
    title: "Pipeline runs",
    description: "Inspect recent ingestion and moderation activity across the platform.",
  },
};

async function adminFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  return fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  });
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? new Intl.NumberFormat("en-GB").format(value) : "—";
}

function formatDate(value?: string | null, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", includeTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" }
  ).format(date);
}

function timeAgo(value?: string | null) {
  if (!value) return "No activity yet";
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(difference / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : formatDate(value);
}

function formatRate(job: JobRow) {
  if (!job.rate_min && !job.rate_max) return "Rate not shown";
  const suffix = job.rate_type === "day" ? "/day" : job.rate_type === "hour" ? "/hr" : job.rate_type ? `/${job.rate_type}` : "";
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
  if (job.rate_min && job.rate_max && job.rate_min !== job.rate_max) {
    return `${formatter.format(job.rate_min)}–${formatter.format(job.rate_max)}${suffix}`;
  }
  return `${formatter.format(job.rate_max ?? job.rate_min ?? 0)}${suffix}`;
}

function statusTone(status?: string | null) {
  const value = (status ?? "TBC").toLowerCase();
  if (value.includes("outside")) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value.includes("inside")) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Database size={19} />
      </span>
      <p className="mt-4 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
          {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function AdminPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<Section>("stats");
  const [data, setData] = useState<AdminData | null>(null);
  const [busy, setBusy] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expiringId, setExpiringId] = useState<string | null>(null);

  const load = useCallback(async (target: Section) => {
    setBusy(true);
    setError(null);
    try {
      const response = await adminFetch(`/api/admin?section=${target}`);
      if (response.status === 401) {
        setSessionReady(false);
        return;
      }
      if (response.status === 403) {
        setForbidden(true);
        return;
      }
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to load admin data");
      setData(json);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load admin data");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && user && sessionReady) load(section);
    if (!loading && !user) {
      setBusy(false);
      setForbidden(true);
    }
  }, [user, loading, section, load, sessionReady]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const navigate = (next: Section) => {
    setSection(next);
    setQuery("");
    setNotice(null);
    setMobileOpen(false);
  };

  const unlockAdmin = async () => {
    setUnlocking(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await response.json();
      if (response.status === 401 || response.status === 403) {
        setForbidden(true);
        return;
      }
      if (!response.ok) throw new Error(json.error ?? "Unable to unlock secure administration");
      setForbidden(false);
      setBusy(true);
      setSessionReady(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to unlock secure administration");
    } finally {
      setUnlocking(false);
    }
  };

  const lockAndSignOut = async (destination = "/") => {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
    await signOut();
    router.replace(destination);
  };

  const expireJob = async (job: JobRow) => {
    if (!window.confirm(`Expire “${job.title}”? It will no longer appear in the live job search.`)) return;
    setExpiringId(job.id);
    setError(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "expire_job", jobId: job.id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to expire this job");
      setNotice(`“${job.title}” was removed from the live inventory.`);
      await load("jobs");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to expire this job");
    } finally {
      setExpiringId(null);
    }
  };

  const normalisedQuery = query.trim().toLowerCase();
  const jobs = (data?.jobs ?? []).filter((job) => !normalisedQuery || [job.title, job.company_name, job.location, job.source_domain, job.ir35_status]
    .some((value) => value?.toLowerCase().includes(normalisedQuery)));
  const users = (data?.users ?? []).filter((account) => !normalisedQuery || [account.email, account.profile?.full_name, account.provider]
    .some((value) => value?.toLowerCase().includes(normalisedQuery)));
  const waitlist = (Array.isArray(data?.waitlist) ? data.waitlist : []).filter((entry) => !normalisedQuery || entry.email.toLowerCase().includes(normalisedQuery));
  const runs = (data?.runs ?? []).filter((run) => !normalisedQuery || run.run_type.toLowerCase().includes(normalisedQuery) || JSON.stringify(run.summary).toLowerCase().includes(normalisedQuery));

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b0f17] text-slate-400">
        <div className="flex items-center gap-3 text-sm"><Loader2 className="animate-spin text-emerald-400" size={20} /> Opening admin workspace…</div>
      </main>
    );
  }

  if (forbidden) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0f17] px-5 py-12 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.12),transparent_35%)]" />
        <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.055] p-7 text-center shadow-2xl backdrop-blur-xl sm:p-9">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
            <ShieldAlert size={25} />
          </span>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Protected workspace</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Admin access required</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">Only approved IR35Careers administrator accounts can create a short-lived admin session.</p>
          {user ? (
            <button type="button" onClick={() => void lockAndSignOut("/account?next=/admin")} className="mt-7 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#0b0f17]">
              Try a different account <ArrowRight size={15} />
            </button>
          ) : (
            <Link href="/account?next=/admin" className="mt-7 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#0b0f17]">
              Continue to sign in <ArrowRight size={15} />
            </Link>
          )}
          <Link href="/" className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"><Home size={14} /> Back to website</Link>
        </div>
      </main>
    );
  }

  if (!sessionReady) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0f17] px-5 py-12 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.12),transparent_35%)]" />
        <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.055] p-7 text-center shadow-2xl backdrop-blur-xl sm:p-9">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><LockKeyhole size={25} /></span>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Short-lived secure session</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Unlock administration</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">Your account will be verified on the server before a protected, HttpOnly admin session is opened for 20 minutes.</p>
          <p className="mt-5 rounded-xl border border-white/[0.08] bg-black/20 px-4 py-3 text-xs text-slate-400">Signed in as <span className="font-semibold text-slate-200">{user?.email}</span></p>
          {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
          <button type="button" onClick={() => void unlockAdmin()} disabled={unlocking} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-70 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#0b0f17]">
            {unlocking ? <Loader2 className="animate-spin" size={16} /> : <LockKeyhole size={16} />} {unlocking ? "Verifying account…" : "Unlock for 20 minutes"}
          </button>
          <Link href="/" className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"><Home size={14} /> Back to website</Link>
        </div>
      </main>
    );
  }

  const current = SECTION_COPY[section];
  const sidebar = (
    <>
      <div className="flex h-20 items-center justify-between border-b border-white/[0.07] px-5">
        <Link href="/" className="flex items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-emerald-950 shadow-[0_0_28px_rgba(16,185,129,0.2)]"><BriefcaseBusiness size={20} /></span>
          <span><span className="block text-sm font-bold tracking-tight text-white">IR35Careers</span><span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">Admin workspace</span></span>
        </Link>
        <button type="button" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden" aria-label="Close admin navigation"><X size={18} /></button>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-5" aria-label="Admin navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-6">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const selected = section === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => navigate(item.id)}
                    aria-current={selected ? "page" : undefined}
                    className={`group flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-400 ${selected ? "bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]" : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100"}`}
                  >
                    <item.icon size={17} className={selected ? "text-emerald-400" : "text-slate-500 group-hover:text-slate-300"} />
                    <span className="flex-1">{item.label}</span>
                    {selected && <ChevronRight size={14} className="text-slate-600" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-8 rounded-2xl border border-emerald-400/10 bg-gradient-to-br from-emerald-400/[0.1] to-cyan-400/[0.04] p-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300"><ShieldCheck size={16} /></span>
          <p className="mt-3 text-xs font-semibold text-slate-100">Private operations area</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">Every moderation action is recorded in your audit trail.</p>
        </div>
      </nav>

      <div className="border-t border-white/[0.07] p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-300"><UserRound size={16} /></span>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-white">Administrator</p><p className="truncate text-[11px] text-slate-500">{user?.email}</p></div>
          <button type="button" onClick={() => void lockAndSignOut()} className="rounded-lg p-2 text-slate-500 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" aria-label="Lock admin and sign out"><LogOut size={15} /></button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#f5f7f9] text-slate-950">
      {mobileOpen && <button type="button" className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-white/[0.06] bg-[#0b0f17] transition-transform duration-200 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>{sidebar}</aside>

      <div className="lg:pl-[272px]">
        <header className="sticky top-0 z-30 flex h-20 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-6 xl:px-8">
          <button type="button" onClick={() => setMobileOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 lg:hidden" aria-label="Open admin navigation"><Menu size={18} /></button>
          <div className="relative max-w-xl flex-1">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" placeholder={`Search ${section === "stats" ? "recent roles" : current.title.toLowerCase()}…`} aria-label={`Search ${current.title}`} />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:block">/</kbd>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" target="_blank" className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-950 sm:inline-flex">View website <ExternalLink size={14} /></Link>
            <button type="button" onClick={() => load(section)} disabled={busy} className="flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70" aria-label="Refresh admin data"><RefreshCw size={14} className={busy ? "animate-spin" : ""} /><span className="hidden sm:inline">Refresh</span></button>
          </div>
        </header>

        <main className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6 sm:py-8 xl:px-8">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">{current.eyebrow}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-[30px]">{current.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{current.description}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" /> Secure live data</div>
          </div>

          {error && <div role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><ShieldAlert className="mt-0.5 shrink-0" size={16} /><span className="flex-1">{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={15} /></button></div>}
          {notice && <div role="status" className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="mt-0.5 shrink-0" size={16} /><span className="flex-1">{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15} /></button></div>}

          {busy ? (
            <div className="mt-8 grid animate-pulse gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading admin data">
              {[0, 1, 2, 3].map((item) => <div key={item} className="h-40 rounded-2xl border border-slate-200 bg-white" />)}
            </div>
          ) : section === "stats" && data ? (
            <Overview data={data} query={normalisedQuery} onNavigate={navigate} />
          ) : section === "jobs" && data ? (
            <JobsPanel jobs={jobs} total={(data.jobs ?? []).length} query={normalisedQuery} expiringId={expiringId} onExpire={expireJob} />
          ) : section === "users" && data ? (
            <UsersPanel users={users} total={data.total ?? (data.users ?? []).length} query={normalisedQuery} />
          ) : section === "waitlist" && data ? (
            <LaunchAudiencePanel entries={waitlist} total={Array.isArray(data.waitlist) ? data.waitlist.length : 0} query={normalisedQuery} />
          ) : section === "runs" && data ? (
            <RunsPanel runs={runs} query={normalisedQuery} />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function Overview({ data, query, onNavigate }: { data: AdminData; query: string; onNavigate: (section: Section) => void }) {
  const profiles = data.profiles ?? 0;
  const cvs = data.cvsUploaded ?? 0;
  const cvReadiness = profiles > 0 ? Math.round((cvs / profiles) * 100) : 0;
  const inventory = (data.liveJobs ?? 0) + (data.expiredJobs ?? 0);
  const liveShare = inventory > 0 ? Math.round(((data.liveJobs ?? 0) / inventory) * 100) : 0;
  const breakdown = data.ir35Breakdown ?? { outside: 0, inside: 0, tbc: 0 };
  const breakdownTotal = (breakdown.outside ?? 0) + (breakdown.inside ?? 0) + (breakdown.tbc ?? 0);
  const recentJobs = (data.recentJobs ?? []).filter((job) => !query || [job.title, job.company_name, job.location, job.source_domain].some((value) => value?.toLowerCase().includes(query)));
  const latestRun = data.lastPipelineRun;

  const cards = [
    { label: "Active jobs", value: data.liveJobs, icon: BriefcaseBusiness, tone: "bg-emerald-50 text-emerald-700", detail: `${liveShare}% of total inventory is live`, badge: "Live" },
    { label: "Contractors", value: data.totalUsers, icon: Users, tone: "bg-blue-50 text-blue-700", detail: `${formatNumber(profiles)} completed profiles`, badge: "Members" },
    { label: "CV readiness", value: `${cvReadiness}%`, icon: FileCheck2, tone: "bg-violet-50 text-violet-700", detail: `${formatNumber(cvs)} of ${formatNumber(profiles)} profiles`, badge: "Adoption" },
    { label: "Launch audience", value: typeof data.waitlist === "number" ? data.waitlist : 0, icon: Mail, tone: "bg-amber-50 text-amber-700", detail: "Former opt-ins for one access notice", badge: "Private" },
  ];

  return (
    <div className="mt-7 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-200/40">
            <div className="flex items-center justify-between"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}><card.icon size={18} /></span><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">{card.badge}</span></div>
            <p className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-slate-950 tabular-nums">{typeof card.value === "string" ? card.value : formatNumber(card.value)}</p>
            <p className="mt-1 text-sm font-medium text-slate-700">{card.label}</p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><TrendingUp size={13} className="text-emerald-600" /> {card.detail}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
        <Panel title="Job inventory" description="Current live sample grouped by the IR35 status shown in each listing." action={<button type="button" onClick={() => onNavigate("jobs")} className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800">Manage jobs <ArrowRight size={13} /></button>}>
          <div className="grid gap-7 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div>
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-label="IR35 status distribution">
                {[{ key: "outside", color: "bg-emerald-500" }, { key: "inside", color: "bg-rose-500" }, { key: "tbc", color: "bg-amber-400" }].map(({ key, color }) => {
                  const value = breakdown[key as keyof typeof breakdown] ?? 0;
                  return <span key={key} className={color} style={{ width: `${breakdownTotal ? Math.max((value / breakdownTotal) * 100, value ? 2 : 0) : 0}%` }} />;
                })}
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[{ label: "Outside IR35", value: breakdown.outside, dot: "bg-emerald-500" }, { label: "Inside IR35", value: breakdown.inside, dot: "bg-rose-500" }, { label: "Status TBC", value: breakdown.tbc, dot: "bg-amber-400" }].map((item) => (
                  <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3.5"><p className="flex items-center gap-2 text-xs text-slate-500"><span className={`h-2 w-2 rounded-full ${item.dot}`} />{item.label}</p><p className="mt-2 text-xl font-semibold tabular-nums text-slate-900">{formatNumber(item.value)}</p></div>
                ))}
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs"><span className="text-slate-500">Based on the latest {formatNumber(breakdownTotal)} live roles</span><span className="font-semibold text-slate-700">{formatNumber(data.expiredJobs)} archived</span></div>
            </div>
            <div className="flex flex-col items-center rounded-2xl bg-slate-950 px-6 py-7 text-white">
              <div className="relative flex h-28 w-28 items-center justify-center rounded-full" style={{ background: `conic-gradient(#34d399 ${liveShare * 3.6}deg, #263244 0deg)` }}>
                <div className="flex h-[86px] w-[86px] flex-col items-center justify-center rounded-full bg-slate-950"><span className="text-2xl font-semibold tabular-nums">{liveShare}%</span><span className="text-[10px] uppercase tracking-wider text-slate-500">Live</span></div>
              </div>
              <p className="mt-4 text-sm font-semibold">Inventory health</p><p className="mt-1 text-center text-[11px] leading-5 text-slate-400">Live vs. archived listings across the full catalogue.</p>
            </div>
          </div>
        </Panel>

        <Panel title="Pipeline health" description="The most recent successful job-fetch activity.">
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-4 rounded-2xl bg-emerald-50 p-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white"><Zap size={19} /></span><div><p className="text-sm font-semibold text-emerald-950">{latestRun ? "Pipeline reporting" : "Waiting for first run"}</p><p className="mt-0.5 text-xs text-emerald-700">{timeAgo(latestRun?.created_at)}</p></div></div>
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Last completed</span><span className="font-medium text-slate-900">{formatDate(latestRun?.created_at, true)}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Run type</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{latestRun?.run_type?.replaceAll("_", " ") ?? "Not available"}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Audit coverage</span><span className="inline-flex items-center gap-1.5 font-medium text-emerald-700"><CheckCircle2 size={14} /> Enabled</span></div>
            </div>
            <button type="button" onClick={() => onNavigate("runs")} className="mt-6 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">View run history <ArrowRight size={13} /></button>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
        <Panel title="Latest job activity" description="The newest live roles available to contractors." action={<span className="hidden items-center gap-1.5 text-[11px] text-slate-500 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Updating from live data</span>}>
          {recentJobs.length ? <div className="divide-y divide-slate-100">{recentJobs.map((job) => <div key={job.id} className="group flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50/80 sm:px-6"><span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 sm:flex"><BriefcaseBusiness size={16} /></span><div className="min-w-0 flex-1"><Link href={`/jobs/${job.id}`} className="block truncate text-sm font-semibold text-slate-900 hover:text-emerald-700">{job.title}</Link><p className="mt-1 truncate text-xs text-slate-500">{job.company_name || "Company not shown"} · {job.location || "UK"}</p></div><div className="hidden text-right md:block"><p className="text-xs font-semibold text-slate-700">{formatRate(job)}</p><p className="mt-1 text-[11px] text-slate-400">{timeAgo(job.first_seen_at)}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusTone(job.ir35_status)}`}>{job.ir35_status || "TBC"}</span></div>)}</div> : <EmptyState title={query ? "No matching roles" : "No recent roles"} detail={query ? "Try a broader search term." : "New roles will appear after the next successful pipeline run."} />}
        </Panel>

        <Panel title="Top sources" description="Sources contributing to the current live sample.">
          <div className="space-y-5 p-5 sm:p-6">
            {(data.topSources ?? []).length ? data.topSources?.map((source, index) => {
              const maximum = Math.max(...(data.topSources ?? []).map((item) => item.count), 1);
              return <div key={source.source}><div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate font-medium text-slate-700"><span className="mr-2 text-slate-400">{String(index + 1).padStart(2, "0")}</span>{source.source}</span><span className="font-semibold tabular-nums text-slate-900">{source.count}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${(source.count / maximum) * 100}%` }} /></div></div>;
            }) : <EmptyState title="No source data" detail="Source distribution will appear when live roles are available." />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function JobsPanel({ jobs, total, query, expiringId, onExpire }: { jobs: JobRow[]; total: number; query: string; expiringId: string | null; onExpire: (job: JobRow) => void }) {
  return (
    <div className="mt-7">
      <Panel title="All recent listings" description={`${formatNumber(total)} roles loaded · newest first`} action={<span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">{formatNumber(jobs.filter((job) => !job.expired_at).length)} live</span>}>
        {jobs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left"><thead><tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><th className="px-6 py-3.5">Role</th><th className="px-4 py-3.5">IR35 status</th><th className="px-4 py-3.5">Rate</th><th className="px-4 py-3.5">Source</th><th className="px-4 py-3.5">Added</th><th className="px-6 py-3.5 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{jobs.map((job) => <tr key={job.id} className="group hover:bg-slate-50/70"><td className="px-6 py-4"><Link href={`/jobs/${job.id}`} className="block max-w-[340px] truncate text-sm font-semibold text-slate-900 hover:text-emerald-700">{job.title}</Link><p className="mt-1 max-w-[340px] truncate text-xs text-slate-500">{job.company_name || "Company not shown"} · {job.location || "Location not shown"}</p></td><td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusTone(job.ir35_status)}`}>{job.ir35_status || "TBC"}</span></td><td className="px-4 py-4 text-xs font-medium text-slate-700">{formatRate(job)}</td><td className="px-4 py-4 text-xs text-slate-500">{job.source_domain || "Unknown"}</td><td className="px-4 py-4"><p className="text-xs font-medium text-slate-700">{timeAgo(job.first_seen_at)}</p><p className="mt-1 text-[11px] text-slate-400">{formatDate(job.first_seen_at)}</p></td><td className="px-6 py-4 text-right">{job.expired_at ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Archived</span> : <button type="button" onClick={() => onExpire(job)} disabled={expiringId === job.id} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60">{expiringId === job.id ? <Loader2 size={13} className="animate-spin" /> : null} Expire</button>}</td></tr>)}</tbody></table></div> : <EmptyState title={query ? "No matching jobs" : "No jobs found"} detail={query ? "Clear the search or try a company, location or source." : "The job pipeline has not returned any listings yet."} />}
      </Panel>
    </div>
  );
}

function UsersPanel({ users, total, query }: { users: UserRow[]; total: number; query: string }) {
  const withCv = users.filter((account) => account.profile?.cv_filename).length;
  return (
    <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
      <Panel title="Contractor accounts" description={`${formatNumber(total)} registered accounts`}>
        {users.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><th className="px-6 py-3.5">Contractor</th><th className="px-4 py-3.5">Sign-in</th><th className="px-4 py-3.5">Skills</th><th className="px-4 py-3.5">CV status</th><th className="px-6 py-3.5">Joined</th></tr></thead><tbody className="divide-y divide-slate-100">{users.map((account) => <tr key={account.id} className="hover:bg-slate-50/70"><td className="px-6 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{(account.profile?.full_name || account.email || "A").charAt(0).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{account.profile?.full_name || "Name not added"}</p><p className="mt-0.5 truncate text-xs text-slate-500">{account.email || "No email"}</p></div></div></td><td className="px-4 py-4 text-xs capitalize text-slate-600">{account.provider || "email"}</td><td className="px-4 py-4 text-xs font-semibold tabular-nums text-slate-700">{account.profile?.skills?.length ?? 0}</td><td className="px-4 py-4">{account.profile?.cv_filename ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 size={14} /> Uploaded</span> : <span className="text-xs text-slate-400">Not uploaded</span>}</td><td className="px-6 py-4"><p className="text-xs text-slate-700">{formatDate(account.created_at)}</p><p className="mt-1 text-[11px] text-slate-400">{timeAgo(account.created_at)}</p></td></tr>)}</tbody></table></div> : <EmptyState title={query ? "No matching contractors" : "No contractor accounts"} detail={query ? "Try searching by name, email or sign-in provider." : "New registrations will appear here."} />}
      </Panel>
      <Panel title="Profile readiness" description="A quick adoption snapshot for the loaded accounts.">
        <div className="p-6"><div className="flex items-end justify-between"><span className="text-4xl font-semibold tracking-[-0.05em] text-slate-950">{users.length ? Math.round((withCv / users.length) * 100) : 0}%</span><FileCheck2 className="text-violet-600" size={22} /></div><p className="mt-2 text-sm font-medium text-slate-700">CV adoption</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${users.length ? (withCv / users.length) * 100 : 0}%` }} /></div><dl className="mt-6 space-y-3 border-t border-slate-100 pt-5 text-sm"><div className="flex justify-between"><dt className="text-slate-500">Loaded accounts</dt><dd className="font-semibold tabular-nums">{users.length}</dd></div><div className="flex justify-between"><dt className="text-slate-500">CV uploaded</dt><dd className="font-semibold tabular-nums">{withCv}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Needs CV</dt><dd className="font-semibold tabular-nums">{Math.max(users.length - withCv, 0)}</dd></div></dl></div>
      </Panel>
    </div>
  );
}

function LaunchAudiencePanel({ entries, total, query }: { entries: Array<{ email: string; created_at: string }>; total: number; query: string }) {
  return (
    <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title="Former waitlist recipients" description={`${formatNumber(total)} permission-based sign-ups · newest first`}>
        {entries.length ? <div className="divide-y divide-slate-100">{entries.map((entry, index) => <div key={`${entry.email}-${entry.created_at}`} className="flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50/70 sm:px-6"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{entry.email}</p><p className="mt-1 text-xs text-slate-500">Joined {formatDate(entry.created_at, true)}</p></div><span className="hidden text-xs font-medium text-slate-400 sm:block">{timeAgo(entry.created_at)}</span></div>)}</div> : <EmptyState title={query ? "No matching recipients" : "No launch recipients"} detail={query ? "Try a different email search." : "No historical waitlist records are stored."} />}
      </Panel>
      <Panel title="Launch notice" description="Prepared, but deliberately not sent."><div className="p-6"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Mail size={19} /></span><p className="mt-5 text-sm font-semibold text-slate-950">IR35Careers is now open — your access is ready</p><p className="mt-3 text-xs leading-5 text-slate-500">A branded one-time access email is ready for review. Delivery remains disabled until the final preview and recipient audit are explicitly approved.</p><span className="mt-5 inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800">Approval required</span></div></Panel>
    </div>
  );
}

function RunsPanel({ runs, query }: { runs: RunRow[]; query: string }) {
  return (
    <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Panel title="Audit timeline" description="The 20 latest pipeline and administrator events.">
        {runs.length ? <div className="divide-y divide-slate-100">{runs.map((run, index) => <div key={`${run.created_at}-${index}`} className="flex gap-4 px-5 py-5 sm:px-6"><div className="flex flex-col items-center"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${run.run_type === "admin_action" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{run.run_type === "admin_action" ? <ShieldCheck size={16} /> : <Activity size={16} />}</span>{index < runs.length - 1 && <span className="mt-2 h-full w-px bg-slate-100" />}</div><div className="min-w-0 flex-1"><div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center"><p className="text-sm font-semibold capitalize text-slate-900">{run.run_type.replaceAll("_", " ")}</p><span className="text-[11px] text-slate-400">{formatDate(run.created_at, true)}</span></div><div className="mt-3 flex flex-wrap gap-2">{Object.entries(run.summary ?? {}).slice(0, 6).map(([key, value]) => <span key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600"><strong className="font-semibold text-slate-800">{key.replaceAll("_", " ")}:</strong> {typeof value === "object" ? JSON.stringify(value) : String(value)}</span>)}</div></div></div>)}</div> : <EmptyState title={query ? "No matching runs" : "No run history"} detail={query ? "Try a broader run type or summary term." : "Pipeline and moderation activity will appear here."} />}
      </Panel>
      <Panel title="System status" description="Core controls for this private workspace."><div className="space-y-3 p-5"><div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Gauge size={16} /></span><div><p className="text-xs font-semibold text-slate-800">Admin API</p><p className="mt-0.5 text-[11px] text-emerald-700">Connected</p></div></div><div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Database size={16} /></span><div><p className="text-xs font-semibold text-slate-800">Supabase data</p><p className="mt-0.5 text-[11px] text-emerald-700">Authorised</p></div></div><div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-700"><ShieldCheck size={16} /></span><div><p className="text-xs font-semibold text-slate-800">Audit logging</p><p className="mt-0.5 text-[11px] text-emerald-700">Enabled</p></div></div></div></Panel>
    </div>
  );
}
