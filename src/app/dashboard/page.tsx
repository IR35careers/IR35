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
  ArrowRight,
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
    { icon: Target, value: matches.length > 0 ? String(matches.length) : "0", label: "Recommended", detail: "Matched to your profile", href: "#matches", tone: "from-[#d8fff0] to-[#f3fffb]", iconTone: "bg-emerald-600 text-white", accent: "text-emerald-900" },
    { icon: ShieldCheck, value: String(outsideCount), label: "Outside IR35", detail: "Clear status evidence", href: "/jobs?ir35=outside", tone: "from-[#ddf7ff] to-[#f3fcff]", iconTone: "bg-cyan-600 text-white", accent: "text-cyan-950" },
    { icon: PoundSterling, value: avgRate ? `£${avgRate}` : "N/A", label: "Average day rate", detail: "Across your matches", href: "/jobs", tone: "from-[#fff3c7] to-[#fffaf0]", iconTone: "bg-amber-500 text-amber-950", accent: "text-amber-950" },
    { icon: Briefcase, value: liveTotal !== null ? liveTotal.toLocaleString() : "N/A", label: "Live contracts", detail: "Fresh UK opportunities", href: "/jobs", tone: "from-[#ede7ff] to-[#faf8ff]", iconTone: "bg-violet-600 text-white", accent: "text-violet-950" },
  ];

  const checklist = [
    ["Skills added", (profile?.skills.length ?? 0) > 0],
    ["Experience added", profile?.years_experience != null],
    ["Preferences set", !!profile?.preferred_ir35],
    ["Resume uploaded", !!profile?.cv_filename],
  ] as const;

  const nextApplication = workspace.applications.find((application) => application.status === "needs_review")
    ?? workspace.applications.find((application) => application.status === "failed")
    ?? workspace.applications.find((application) => application.status === "ready");
  const nextAction = nextApplication
    ? {
        eyebrow: nextApplication.status === "ready" ? "Ready to send" : "Needs your attention",
        title: nextApplication.status === "ready" ? "Your application is ready" : `Continue ${nextApplication.job.title}`,
        detail: nextApplication.status === "ready"
          ? `Review the final application for ${nextApplication.job.company_name} and submit it.`
          : "Your work is saved. Open the application to complete the remaining step.",
        href: `/applications/new/${nextApplication.job.id}?applicationId=${encodeURIComponent(nextApplication.id)}${nextApplication.status === "needs_review" ? "#needs-attention" : ""}`,
        label: nextApplication.status === "ready" ? "Review and apply" : "Continue application",
      }
    : pct < 80
      ? {
          eyebrow: "Build a stronger match",
          title: "Finish your contractor profile",
          detail: "Add the missing details once so future applications need less input.",
          href: "/profile#application-readiness",
          label: "Complete profile",
        }
      : {
          eyebrow: "Your next opportunity",
          title: matches.length ? `${matches.length} contracts match your profile` : "Fresh contracts are ready to explore",
          detail: "Compare the strongest matches and choose where you want to apply.",
          href: matches.length ? "#matches" : "/jobs",
          label: matches.length ? "See best matches" : "Browse contracts",
        };

  return (
    <div className="ir35-workspace-canvas min-h-screen text-slate-900" data-workspace-surface="dashboard">
      <WelcomeModal userId={user?.id ?? PREVIEW_PROFILE.id} />
      <AppNav />
      <main className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
        <section className="relative overflow-hidden rounded-[28px] border border-emerald-950/10 bg-[#071f28] text-white shadow-[0_28px_80px_-46px_rgba(2,44,34,0.8)]">
          <div className="pointer-events-none absolute -right-24 -top-36 h-[360px] w-[360px] rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-40 left-[32%] h-[340px] w-[340px] rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="relative grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] lg:items-stretch lg:p-8">
            <div className="flex min-h-[250px] flex-col justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300">Contractor workspace</p>
                <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-[2.65rem]">
                  {dashboardGreeting}
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Find the right contract, prepare your application and keep every response connected.</p>
              </div>
              <form onSubmit={onSearch} className="relative mt-7 w-full max-w-2xl" data-tour="dashboard-search">
                <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search" value={q} onChange={(event) => setQ(event.target.value)}
                  placeholder="Search roles, skills or companies"
                  className="ir35-focus min-h-[52px] w-full rounded-2xl border border-white/15 bg-white/[0.09] pl-11 pr-28 text-sm text-white shadow-inner backdrop-blur placeholder:text-slate-400 focus:bg-white/[0.13]"
                />
                <button type="submit" className="ir35-focus absolute right-1.5 top-1/2 min-h-10 -translate-y-1/2 rounded-xl bg-emerald-400 px-5 text-xs font-bold text-emerald-950 transition hover:bg-emerald-300">Search</button>
              </form>
            </div>

            <div className="group relative flex min-h-[250px] flex-col justify-between overflow-hidden rounded-3xl border border-white/15 bg-white/[0.09] p-5 backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.12] sm:p-6">
              <div className="absolute right-0 top-0 h-28 w-28 rounded-bl-[80px] bg-gradient-to-br from-emerald-300/25 to-cyan-300/5" />
              <div className="relative">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-300 text-emerald-950 shadow-[0_12px_34px_-18px_rgba(110,231,183,0.9)]"><Sparkles size={20} /></span>
                <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.17em] text-emerald-300">{nextAction.eyebrow}</p>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-white sm:text-2xl">{nextAction.title}</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">{nextAction.detail}</p>
              </div>
              <Link href={nextAction.href} className="ir35-focus relative mt-6 inline-flex min-h-11 items-center justify-between rounded-xl bg-white px-4 text-sm font-bold text-slate-950 transition group-hover:bg-emerald-50">
                {nextAction.label}<ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </section>

        <ApplicationJourney
          profileReady={(profile?.skills.length ?? 0) > 0 && Boolean(profile?.cv_filename)}
          applications={workspace.applications}
        />

        <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Contract summary">
          {stats.map((stat) => (
            <Link key={stat.label} href={stat.href} className={`group relative min-h-[144px] overflow-hidden rounded-2xl border border-white/80 bg-gradient-to-br ${stat.tone} p-4 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.42)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-28px_rgba(15,23,42,0.34)] sm:p-5`}>
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl shadow-sm ${stat.iconTone}`}><stat.icon size={18} /></span>
              <span className={`mt-5 block text-2xl font-semibold tabular-nums tracking-[-0.04em] sm:text-[28px] ${stat.accent}`}>{stat.value}</span>
              <span className="mt-0.5 block text-xs font-semibold text-slate-800">{stat.label}</span>
              <span className="mt-2 hidden text-[11px] text-slate-600 sm:block">{stat.detail}</span>
              <ChevronRight size={16} className="absolute right-4 top-4 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-slate-700" />
            </Link>
          ))}
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section id="matches" className="ir35-card ir35-aurora-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-emerald-100 bg-white/55 px-5 py-4 sm:px-6">
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
              <ul className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                {matches.slice(0, 6).map(({ job, score, matchedSkills }, index) => {
                  const cardTones = ["bg-emerald-50/80", "bg-cyan-50/80", "bg-amber-50/80", "bg-violet-50/80"];
                  const companyName = job.company_name || "Company not shown";
                  return (
                    <li key={job.id}>
                      <Link href={`/jobs/${job.id}`} className={`group flex h-full min-h-[178px] flex-col rounded-2xl border border-white p-4 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)] transition duration-300 hover:-translate-y-0.5 hover:shadow-lg ${cardTones[index % cardTones.length]}`}>
                        <div className="flex items-start justify-between gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-bold text-slate-700 shadow-sm">{companyName.charAt(0).toUpperCase()}</span>
                          <ScoreRing score={score} />
                        </div>
                        <div className="mt-4 min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-950">{job.title}</p>
                          <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500">{companyName}<span aria-hidden="true">·</span><MapPin size={11} />{job.location || "UK"}</p>
                          {matchedSkills.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{matchedSkills.slice(0, 3).map((skill) => <span key={skill} className="rounded-md bg-white/85 px-2 py-1 text-[10px] font-medium text-slate-600 shadow-sm">{skill}</span>)}</div>}
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-900/[0.06] pt-3"><span className="text-sm font-semibold tabular-nums text-slate-900">{formatRate(job)}</span><IR35Chip status={job.ir35_status} /></div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside className="space-y-5">
            <section className="ir35-card ir35-aurora-panel p-5" data-tour="profile-progress">
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
