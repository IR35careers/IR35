"use client";

/**
 * /dashboard — signed-in home, matching the reference layout:
 *   AppNav · greeting + search · 4 quick-stat cards · main column
 *   (top matches with score rings, your applications) · right rail
 *   (profile strength + checklist, plan).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Loader2,
  Search,
  Briefcase,
  ShieldCheck,
  PoundSterling,
  Target,
  MapPin,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  Circle,
  CloudOff,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { formatRate, type JobListing } from "@/lib/job-types";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { useWorkspaceCloudSync, useWorkspaceState } from "@/lib/workspace/store";
import { AppNav } from "@/components/AppNav";
import { ApplicationJourney } from "@/components/workspace/ApplicationJourney";
import { WelcomeModal } from "@/components/WelcomeModal";
import { useContractorPortalBoundary } from "@/components/useContractorPortalBoundary";
import {
  fetchMatches,
  getProfile,
  profileStrength,
  PREVIEW_PROFILE,
  scoreJob,
  timeGreeting,
  type Profile,
  type ScoredJob,
} from "@/lib/profile";

function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  const color = score >= 75 ? "#16a34a" : score >= 50 ? "#4ade80" : "#94a3b8";
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
      </svg>
      <span className="absolute text-[10px] font-bold tabular-nums text-slate-900">{score}%</span>
    </span>
  );
}

function IR35Chip({ status }: { status: JobListing["ir35_status"] }) {
  if (status === "outside")
    return <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">Outside IR35</span>;
  if (status === "inside")
    return <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600">Inside IR35</span>;
  return <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">IR35: TBC</span>;
}

function starterProfile(userId: string, email: string | undefined, fullName: string | undefined): Profile {
  return {
    id: userId,
    full_name: fullName?.trim() || email?.split("@")[0] || "",
    target_rate_min: null,
    preferred_ir35: "either",
    preferred_remote: "any",
    skills: [],
    cv_path: null,
    cv_filename: null,
    phone: null,
    linkedin_url: null,
    job_title: null,
    years_experience: null,
  };
}

function uniqueTrackedJobs(items: Array<{ status: string; job: JobListing }>): Array<{ status: string; job: JobListing }> {
  const byJob = new Map<string, { status: string; job: JobListing }>();
  items.forEach((item) => {
    if (!byJob.has(item.job.id)) byJob.set(item.job.id, item);
  });
  return Array.from(byJob.values());
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const workspace = useWorkspaceState();
  const preview = !isSupabaseConfigured();
  const administratorRedirect = useContractorPortalBoundary(user?.email, loading);
  const cloud = useWorkspaceCloudSync(!preview && !administratorRedirect ? user?.id ?? null : null, user?.email ?? "");

  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false);
  const [matches, setMatches] = useState<ScoredJob[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [liveTotal, setLiveTotal] = useState<number | null>(null);
  const [tracked, setTracked] = useState<Array<{ status: string; job: JobListing }>>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!preview && !administratorRedirect && !loading && !user) router.replace("/account?next=/dashboard");
  }, [administratorRedirect, user, loading, router, preview]);

  useEffect(() => {
    if (preview) {
      setProfile(PREVIEW_PROFILE);
      setChecked(true);
      return;
    }
    if (!user || administratorRedirect) return;
    getProfile(user.id).then((p) => {
      setProfile(p ?? starterProfile(user.id, user.email, typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : undefined));
      setChecked(true);
    });
  }, [administratorRedirect, user, preview]);

  useEffect(() => {
    if (!profile || profile.skills.length === 0) return;
    if (preview) {
      setMatches(DEMO_JOBS.map((job) => scoreJob(job, profile)).filter((item): item is ScoredJob => item !== null));
      return;
    }
    setMatchesLoading(true);
    fetchMatches(profile).then(setMatches).finally(() => setMatchesLoading(false));
  }, [profile, preview]);

  useEffect(() => {
    const applicationItems = workspace.applications.map((application) => ({
      status: application.status,
      job: application.job,
    }));
    if (preview) {
      setLiveTotal(DEMO_JOBS.length);
      setTracked(uniqueTrackedJobs(applicationItems));
      return;
    }
    if (!user || administratorRedirect) return;
    setTracked(uniqueTrackedJobs(applicationItems));
    fetch("/api/jobs/search?per_page=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { total?: number } | null) => j?.total && setLiveTotal(j.total))
      .catch(() => undefined);
    supabase
      .from("saved_jobs")
      .select("status, jobs(id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }: { data: Array<{ status: string; jobs: unknown }> | null }) => {
        const savedItems = (data ?? [])
          .filter((row) => row.jobs)
          .map((row) => ({ status: "saved", job: row.jobs as unknown as JobListing }));
        setTracked(uniqueTrackedJobs([...applicationItems, ...savedItems]));
      });
  }, [administratorRedirect, user, preview, workspace.applications]);

  if (administratorRedirect || (!preview && (loading || !user || cloud.loading)) || !checked || (checked && !profile)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  if (!preview && cloud.error) {
    return <div className="min-h-screen bg-slate-50 text-slate-900"><AppNav /><main className="mx-auto max-w-2xl px-4 py-16 sm:px-6"><div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-950" role="alert"><CloudOff size={24} /><h1 className="mt-4 text-xl font-semibold">We could not open your dashboard</h1><p className="mt-2 text-sm leading-6">Please check your connection and try again. Your information remains protected.</p><button type="button" onClick={() => window.location.reload()} className="ir35-focus mt-5 min-h-11 rounded-xl bg-rose-800 px-4 text-sm font-bold text-white">Try again</button></div></main></div>;
  }

  const pct = profileStrength(profile);
  const accountName = [
    profile?.full_name ?? "",
    typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
    typeof user?.user_metadata?.name === "string" ? user.user_metadata.name : "",
  ].find((value) => value.trim() && !value.includes("@"))?.trim();
  const contractorFirstName = accountName?.split(/\s+/)[0] ?? "";
  const dashboardGreeting = contractorFirstName
    ? `${timeGreeting()}, ${contractorFirstName}`
    : timeGreeting();
  const outsideCount = matches.filter((m) => m.job.ir35_status === "outside").length;
  const dailyRates = matches.map((m) => m.job.rate_max ?? m.job.rate_min).filter((n): n is number => n !== null);
  const avgRate = dailyRates.length ? Math.round(dailyRates.reduce((a, b) => a + b, 0) / dailyRates.length) : null;

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/jobs?q=${encodeURIComponent(q.trim())}` : "/jobs");
  };

  const stats = [
    { icon: Target, value: matches.length > 0 ? String(matches.length) : "0", label: "Recommended", href: "#matches" },
    { icon: ShieldCheck, value: String(outsideCount), label: "Outside IR35", href: "/jobs?ir35=outside" },
    { icon: PoundSterling, value: avgRate ? `£${avgRate}` : "N/A", label: "Average day rate", href: "/jobs" },
    { icon: Briefcase, value: liveTotal !== null ? liveTotal.toLocaleString() : "N/A", label: "Live contracts", href: "/jobs" },
  ];

  const checklist = [
    ["Skills added", (profile?.skills.length ?? 0) > 0],
    ["Experience added", profile?.years_experience != null],
    ["Preferences set", !!profile?.preferred_ir35],
    ["Resume uploaded", !!profile?.cv_filename],
  ] as const;

  return (
    <div className="min-h-screen bg-[#f7f8f6] text-slate-900">
      <WelcomeModal userId={user?.id ?? PREVIEW_PROFILE.id} />
      <AppNav />
      <main className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
        <div className="flex flex-col gap-5 border-b border-slate-200/80 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="ir35-eyebrow">Workspace</p>
            <h1 className="mt-2 text-3xl font-semibold leading-[1.08] tracking-[-0.04em] text-slate-950 sm:text-[2.5rem]">
              {dashboardGreeting}
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">Your contracts, applications and next actions in one place.</p>
          </div>
          <form onSubmit={onSearch} className="relative w-full lg:w-[440px]" data-tour="dashboard-search">
            <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search" value={q} onChange={(event) => setQ(event.target.value)}
              placeholder="Search contracts"
              className="ir35-focus min-h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-24 text-sm shadow-[0_12px_36px_-30px_rgba(15,23,42,0.4)] placeholder:text-slate-400"
            />
            <button type="submit" className="ir35-focus absolute right-1.5 top-1/2 min-h-9 -translate-y-1/2 rounded-lg bg-slate-950 px-4 text-xs font-bold text-white hover:bg-brand-800">Search</button>
          </form>
        </div>

        <ApplicationJourney
          profileReady={(profile?.skills.length ?? 0) > 0 && Boolean(profile?.cv_filename)}
          applications={workspace.applications}
        />

        <section className="ir35-card mt-6 grid grid-cols-2 overflow-hidden lg:grid-cols-4" aria-label="Contract summary">
          {stats.map((stat, index) => (
            <Link key={stat.label} href={stat.href} className={`group flex min-h-[106px] items-center gap-4 p-4 transition-colors hover:bg-slate-50 sm:p-5 ${index % 2 === 0 ? "border-r border-slate-200" : ""} ${index < 2 ? "border-b border-slate-200 lg:border-b-0" : ""} ${index > 0 ? "lg:border-l lg:border-slate-200" : ""}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><stat.icon size={19} /></span>
              <span className="min-w-0"><span className="block text-2xl font-semibold tabular-nums tracking-[-0.03em] text-slate-950">{stat.value}</span><span className="mt-0.5 block text-xs leading-4 text-slate-500">{stat.label}</span></span>
            </Link>
          ))}
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section id="matches" className="ir35-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
              <div>
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-brand-700"><Sparkles size={14} /> Recommended for you</p>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950">Contracts matching your profile</h2>
              </div>
              <Link href="/jobs" className="ir35-focus inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950">View all <ChevronRight size={15} /></Link>
            </div>

            {profile && profile.skills.length === 0 ? (
              <div className="m-5 rounded-xl border border-slate-200 bg-slate-50 p-7 text-center sm:m-6">
                <p className="font-semibold text-slate-900">Complete your profile to see personal recommendations.</p>
                <p className="mt-1 text-sm text-slate-500">Add your skills and Resume once, then reuse them across applications.</p>
                <Link href="/profile#application-readiness" className="ir35-focus mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white hover:bg-brand-800">Complete profile <ChevronRight size={15} /></Link>
              </div>
            ) : matchesLoading ? (
              <div className="flex min-h-56 items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
            ) : matches.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No close matches yet. New contracts are added throughout the day.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {matches.slice(0, 6).map(({ job, score, matchedSkills }) => (
                  <li key={job.id}>
                    <Link href={`/jobs/${job.id}`} className="group grid gap-4 px-5 py-4 transition-colors hover:bg-slate-50 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center sm:px-6">
                      <ScoreRing score={score} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">{job.title}</p>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">{job.company_name}<span aria-hidden="true">·</span><MapPin size={11} />{job.location}</p>
                        {matchedSkills.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{matchedSkills.slice(0, 3).map((skill) => <span key={skill} className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{skill}</span>)}</div>}
                      </div>
                      <div className="flex items-center gap-2 sm:flex-col sm:items-end"><span className="text-sm font-semibold tabular-nums text-slate-900">{formatRate(job)}</span><IR35Chip status={job.ir35_status} /></div>
                      <ChevronRight size={17} className="hidden text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-600 sm:block" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="space-y-5">
            <section className="ir35-card p-5" data-tour="profile-progress">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-950">Profile readiness</h2><Link href="/profile" className="ir35-focus rounded-lg px-2 py-1 text-xs font-bold text-brand-700 hover:bg-brand-50">Edit</Link></div>
              <div className="mt-4 flex items-center gap-4"><ScoreRing score={pct} size={68} /><div><p className="text-sm font-semibold text-slate-900">{pct >= 80 ? "Ready to apply" : pct >= 50 ? "Almost ready" : "Complete your details"}</p><p className="mt-1 text-xs leading-5 text-slate-500">A stronger profile reduces questions during applications.</p></div></div>
              <ul className="mt-4 grid grid-cols-2 gap-2">
                {checklist.map(([label, done]) => <li key={label} className="flex items-center gap-2 text-xs">{done ? <CheckCircle2 size={14} className="shrink-0 text-brand-600" /> : <Circle size={14} className="shrink-0 text-slate-300" />}<span className={done ? "text-slate-700" : "text-slate-400"}>{label}</span></li>)}
              </ul>
              {pct < 100 && <Link href="/profile#application-readiness" className="ir35-focus mt-5 inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50">Finish profile <ChevronRight size={14} /></Link>}
            </section>

            <section className="ir35-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-sm font-semibold text-slate-950">Recent applications</p><p className="mt-0.5 text-xs text-slate-500">Latest activity across your tracker</p></div><Link href="/applications" aria-label="Open application tracker" className="ir35-focus rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-950"><ChevronRight size={17} /></Link></div>
              {tracked.length === 0 ? (
                <div className="p-5"><p className="text-sm leading-6 text-slate-500">Your prepared and submitted applications will appear here.</p><Link href="/jobs" className="ir35-focus mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-bold text-brand-700">Browse contracts <ChevronRight size={14} /></Link></div>
              ) : (
                <ul className="divide-y divide-slate-100">{tracked.slice(0, 4).map(({ status, job }) => <li key={job.id}><Link href={`/jobs/${job.id}`} className="group flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50"><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{job.title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{job.company_name}</span></span><span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${status === "applied" ? "border-brand-200 bg-brand-50 text-brand-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{status === "applied" ? "Applied" : "Saved"}</span></Link></li>)}</ul>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
