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
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { formatRate, type JobListing } from "@/lib/job-types";
import { AppNav } from "@/components/AppNav";
import { WelcomeModal } from "@/components/WelcomeModal";
import {
  fetchMatches,
  firstName,
  getProfile,
  profileStrength,
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

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false);
  const [matches, setMatches] = useState<ScoredJob[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [liveTotal, setLiveTotal] = useState<number | null>(null);
  const [tracked, setTracked] = useState<Array<{ status: string; job: JobListing }>>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/account?next=/dashboard");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    getProfile(user.id).then((p) => {
      setProfile(p);
      setChecked(true);
      if (!p) router.replace("/onboarding");
    });
  }, [user, router]);

  useEffect(() => {
    if (!profile || profile.skills.length === 0) return;
    setMatchesLoading(true);
    fetchMatches(profile).then(setMatches).finally(() => setMatchesLoading(false));
  }, [profile]);

  useEffect(() => {
    if (!user) return;
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
        setTracked((data ?? []).filter((r) => r.jobs).map((r) => ({ status: r.status, job: r.jobs as unknown as JobListing })));
      });
  }, [user]);

  if (loading || !user || !checked || (checked && !profile)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  const name = firstName(profile, user.email ?? undefined);
  const pct = profileStrength(profile);
  const outsideCount = matches.filter((m) => m.job.ir35_status === "outside").length;
  const dailyRates = matches.map((m) => m.job.rate_max ?? m.job.rate_min).filter((n): n is number => n !== null);
  const avgRate = dailyRates.length ? Math.round(dailyRates.reduce((a, b) => a + b, 0) / dailyRates.length) : null;

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/jobs?q=${encodeURIComponent(q.trim())}` : "/jobs");
  };

  const stats = [
    { icon: Target, value: matches.length > 0 ? String(matches.length) : "0", label: "Matches for you", sub: "View matches", href: "#matches", accent: "green" },
    { icon: ShieldCheck, value: String(outsideCount), label: "Outside IR35", sub: "View jobs", href: "/jobs?ir35=outside", accent: "green" },
    { icon: PoundSterling, value: avgRate ? `£${avgRate}` : "—", label: "Avg match day rate", sub: "Browse rates", href: "/jobs", accent: "green" },
    { icon: Briefcase, value: liveTotal !== null ? liveTotal.toLocaleString() : "—", label: "Live contracts", sub: "Browse all", href: "/jobs", accent: "green" },
  ];

  const checklist = [
    ["Skills added", (profile?.skills.length ?? 0) > 0],
    ["Experience added", profile?.years_experience != null],
    ["Preferences set", !!profile?.preferred_ir35],
    ["CV uploaded", !!profile?.cv_filename],
  ] as const;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <WelcomeModal name={name} />
      <AppNav />
      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
        {/* Greeting + search */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {timeGreeting()}, <span className="text-green-600">{name}</span>
            </h1>
            <p className="mt-1 text-sm text-slate-500">Here&apos;s your contract overview.</p>
          </div>
          <form onSubmit={onSearch} className="relative w-full lg:w-[420px]">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search roles, skills, companies…"
              className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-24 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
            />
            <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-green-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700">Search</button>
          </form>
        </div>

        {/* Quick stats */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <Link key={s.label} href={s.href} className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-green-300">
              <s.icon className="text-green-600" size={20} />
              <p className="mt-3 text-2xl font-bold tabular-nums text-slate-900">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
              <p className="mt-2 text-xs font-semibold text-green-700">{s.sub} →</p>
            </Link>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Main column */}
          <div className="min-w-0 space-y-6">
            {/* Matches */}
            <section id="matches" className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  <Sparkles size={14} className="text-green-600" /> Top matches for you
                </h2>
                <Link href="/jobs" className="text-sm text-slate-500 hover:text-slate-800">View all →</Link>
              </div>

              {profile && profile.skills.length === 0 ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
                  <p className="text-sm text-slate-700">Add your skills to unlock matches.</p>
                  <Link href="/onboarding" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700">Complete profile <ArrowRight size={14} /></Link>
                </div>
              ) : matchesLoading ? (
                <div className="mt-8 flex justify-center text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
              ) : matches.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No matches yet — new contracts arrive through the day.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {matches.slice(0, 6).map(({ job, score, matchedSkills }) => (
                    <li key={job.id}>
                      <Link href={`/jobs/${job.id}`} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-green-300 hover:bg-green-50/30">
                        <ScoreRing score={score} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{job.title}</p>
                          <p className="flex items-center gap-1 truncate text-xs text-slate-500">
                            {job.company_name} <span aria-hidden>·</span> <MapPin size={10} /> {job.location}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {matchedSkills.slice(0, 3).map((sk) => (
                              <span key={sk} className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">{sk}</span>
                            ))}
                          </div>
                        </div>
                        <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                          <span className="text-sm font-semibold tabular-nums">{formatRate(job)}</span>
                          <IR35Chip status={job.ir35_status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Applications */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Your applications</h2>
                {tracked.length > 0 && <span className="text-xs text-slate-400">{tracked.length} tracked</span>}
              </div>
              {tracked.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  Nothing saved yet. Open any contract and hit <span className="font-medium text-slate-700">Save job</span> to track it here.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-100">
                  {tracked.map(({ status, job }) => (
                    <li key={job.id}>
                      <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-4 py-3 transition-colors hover:bg-slate-50">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{job.title}</p>
                          <p className="truncate text-xs text-slate-500">{job.company_name} · {job.location}</p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${status === "applied" ? "border-green-200 bg-green-50 text-green-700" : "border-rose-200 bg-rose-50 text-rose-600"}`}>
                          {status === "applied" ? "Applied" : "Saved"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Right rail */}
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">Profile strength</h2>
                <Link href="/settings" className="text-xs font-semibold text-green-700 hover:underline">Edit</Link>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <ScoreRing score={pct} size={72} />
                <div>
                  <p className="text-sm font-semibold text-green-700">{pct >= 80 ? "Great!" : pct >= 50 ? "Getting there" : "Let's build this up"}</p>
                  <p className="text-xs text-slate-500">Add more details to improve your matches.</p>
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                {checklist.map(([label, done]) => (
                  <li key={label} className="flex items-center gap-2 text-sm">
                    {done ? <CheckCircle2 size={15} className="text-green-600" /> : <Circle size={15} className="text-slate-300" />}
                    <span className={done ? "text-slate-700" : "text-slate-400"}>{label}</span>
                  </li>
                ))}
              </ul>
              <Link href="/onboarding" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700">Improve profile</Link>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-semibold text-slate-800">Contractor tools</p>
              <div className="mt-3 space-y-2">
                <Link href="/tools/take-home" className="block rounded-xl border border-slate-200 p-3 text-sm transition-colors hover:border-green-300 hover:bg-green-50/30">
                  <span className="font-medium text-slate-800">Take-home calculator</span>
                  <span className="block text-xs text-slate-500">Inside vs outside IR35, 2026/27</span>
                </Link>
                <Link href="/tools/ir35-status" className="block rounded-xl border border-slate-200 p-3 text-sm transition-colors hover:border-green-300 hover:bg-green-50/30">
                  <span className="font-medium text-slate-800">IR35 status checker</span>
                  <span className="block text-xs text-slate-500">Indicative inside/outside view</span>
                </Link>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-semibold text-slate-800">Your plan</p>
              <p className="mt-0.5 text-xs text-slate-500">Free — full access to the board, matches and tools.</p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
