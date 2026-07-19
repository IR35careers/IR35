"use client";

/**
 * /dashboard — full-width, Tsenta-grade layout:
 *   AppNav tabs · greeting + embedded search · stats strip ·
 *   Top matches (ring-score cards, 4-up on desktop) · Fresh on the board.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Loader2,
  Search,
  FileText,
  MapPin,
  ArrowRight,
  Sparkles,
  Briefcase,
  Target,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { formatPosted, formatRate, type JobListing } from "@/lib/job-types";
import { AppNav } from "@/components/AppNav";
import { supabase } from "@/lib/supabase";
import {
  fetchMatches,
  firstName,
  getProfile,
  timeGreeting,
  type Profile,
  type ScoredJob,
} from "@/lib/profile";

function ScoreRing({ score }: { score: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  const color = score >= 75 ? "#34d399" : score >= 50 ? "#38bdf8" : "rgba(255,255,255,0.5)";
  return (
    <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center" title={`Match: ${score}%`}>
      <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3.5" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute text-[10px] font-bold tabular-nums text-white">{score}%</span>
    </span>
  );
}

function IR35Chip({ status }: { status: JobListing["ir35_status"] }) {
  if (status === "outside")
    return <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">Outside IR35</span>;
  if (status === "inside")
    return <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium text-sky-300">Inside IR35</span>;
  return <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/45">IR35: TBC</span>;
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [matches, setMatches] = useState<ScoredJob[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [liveTotal, setLiveTotal] = useState<number | null>(null);
  const [latest, setLatest] = useState<JobListing[]>([]);
  const [tracked, setTracked] = useState<Array<{ status: string; job: JobListing }>>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/account?next=/dashboard");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    getProfile(user.id).then((p) => {
      setProfile(p);
      setProfileChecked(true);
      if (!p) router.replace("/onboarding");
    });
  }, [user, router]);

  useEffect(() => {
    if (!profile || profile.skills.length === 0) return;
    setMatchesLoading(true);
    fetchMatches(profile)
      .then(setMatches)
      .finally(() => setMatchesLoading(false));
  }, [profile]);

  // Saved / applied tracker.
  useEffect(() => {
    if (!user) return;
    supabase
      .from("saved_jobs")
      .select("status, jobs(id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }: { data: Array<{ status: string; jobs: unknown }> | null }) => {
        const rows = (data ?? [])
          .filter((r) => r.jobs)
          .map((r) => ({ status: r.status, job: r.jobs as unknown as JobListing }));
        setTracked(rows);
      });
  }, [user]);

  // Board stats + fresh contracts feed.
  useEffect(() => {
    if (!user) return;
    fetch("/api/jobs/search?per_page=6")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { total?: number; jobs?: JobListing[] } | null) => {
        if (!json) return;
        setLiveTotal(json.total ?? null);
        setLatest(json.jobs ?? []);
      })
      .catch(() => undefined);
  }, [user]);

  if (loading || !user || !profileChecked || (profileChecked && !profile)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0f16] text-white/50">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  const name = firstName(profile, user.email ?? undefined);
  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/jobs?q=${encodeURIComponent(q.trim())}` : "/jobs");
  };

  const stats = [
    {
      icon: Briefcase,
      label: "Live contracts",
      value: liveTotal !== null ? liveTotal.toLocaleString() : "—",
      href: "/jobs",
    },
    {
      icon: Target,
      label: "Your matches",
      value: profile && profile.skills.length > 0 ? String(matches.length) : "0",
      href: null,
    },
    {
      icon: Wrench,
      label: "Skills tracked",
      value: String(profile?.skills.length ?? 0),
      href: "/onboarding",
    },
    {
      icon: FileText,
      label: "CV",
      value: profile?.cv_filename ? "On file" : "Missing",
      href: "/onboarding",
      warn: !profile?.cv_filename,
    },
  ];

  return (
    <div className="min-h-screen bg-[#0a0f16] text-white">
      <AppNav />

      <main className="relative overflow-x-hidden">
        <div className="pointer-events-none fixed inset-0" aria-hidden>
          <div className="absolute -top-40 right-[-10%] h-[440px] w-[440px] rounded-full bg-emerald-500/[0.08] blur-[120px]" />
          <div className="absolute bottom-[-15%] left-[-10%] h-[440px] w-[440px] rounded-full bg-sky-500/[0.07] blur-[130px]" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
          {/* Greeting + search */}
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-light tracking-tight sm:text-4xl">
                {timeGreeting()},{" "}
                <span className="bg-gradient-to-r from-emerald-300 to-sky-300 bg-clip-text text-transparent">
                  {name}
                </span>
              </h1>
              <p className="mt-1.5 text-sm text-white/50">
                {profile?.cv_filename ? (
                  <>CV on file: <span className="text-white/70">{profile.cv_filename}</span></>
                ) : (
                  <Link href="/onboarding" className="text-emerald-300 underline-offset-4 hover:underline">
                    Upload your CV to complete your profile
                  </Link>
                )}
              </p>
            </div>

            <form onSubmit={onSearch} className="relative w-full lg:w-[420px]">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search roles, skills, companies…"
                aria-label="Search contracts"
                className="w-full rounded-xl border border-white/15 bg-white/[0.06] py-3 pl-10 pr-24 text-sm placeholder:text-white/35 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
              />
              <button
                type="submit"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90"
              >
                Search
              </button>
            </form>
          </div>

          {/* Stats strip */}
          <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((stat) => {
              const inner = (
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:border-white/20">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                    <stat.icon size={16} className={stat.warn ? "text-amber-300" : "text-emerald-300"} />
                  </div>
                  <div className="min-w-0">
                    <p className={`truncate text-lg font-semibold tabular-nums ${stat.warn ? "text-amber-300" : ""}`}>
                      {stat.value}
                    </p>
                    <p className="truncate text-xs text-white/45">{stat.label}</p>
                  </div>
                </div>
              );
              return stat.href ? (
                <Link key={stat.label} href={stat.href}>
                  {inner}
                </Link>
              ) : (
                <div key={stat.label}>{inner}</div>
              );
            })}
          </div>

          {/* Top matches */}
          <section className="mt-9">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-white/50">
                <Sparkles size={14} className="text-emerald-300" /> Top matches for you
              </h2>
              <Link href="/jobs" className="inline-flex items-center gap-1 text-sm text-white/50 transition-colors hover:text-white">
                Browse all <ArrowRight size={13} />
              </Link>
            </div>

            {profile && profile.skills.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-white/80">Add your skills to unlock matches.</p>
                <Link href="/onboarding" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90">
                  Complete profile <ArrowRight size={14} />
                </Link>
              </div>
            ) : matchesLoading ? (
              <div className="mt-10 flex justify-center text-white/50">
                <Loader2 className="animate-spin" size={20} />
              </div>
            ) : matches.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-white/80">No matches for your skills yet.</p>
                <p className="mt-1 text-sm text-white/50">New contracts arrive through the day — or broaden your skills.</p>
              </div>
            ) : (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {matches.slice(0, 8).map(({ job, score, matchedSkills }) => (
                  <li key={job.id}>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4 pl-5 transition-all hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.07]"
                    >
                      <span
                        className={`absolute inset-y-0 left-0 w-[3px] ${
                          job.ir35_status === "outside" ? "bg-emerald-400/70" : job.ir35_status === "inside" ? "bg-sky-400/70" : "bg-white/10"
                        }`}
                        aria-hidden
                      />
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="min-w-0 text-sm font-medium leading-snug text-white [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
                          {job.title}
                        </h3>
                        <ScoreRing score={score} />
                      </div>
                      <p className="mt-1 flex items-center gap-1 truncate text-xs text-white/50">
                        {job.company_name} <span aria-hidden>·</span> <MapPin size={10} /> {job.location}
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {matchedSkills.slice(0, 3).map((s) => (
                          <span key={s} className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            {s}
                          </span>
                        ))}
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                        <span className="text-sm font-semibold tabular-nums">{formatRate(job)}</span>
                        <IR35Chip status={job.ir35_status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Your applications tracker */}
          {tracked.length > 0 && (
            <section className="mt-10">
              <h2 className="text-sm font-medium uppercase tracking-wide text-white/50">Your applications</h2>
              <ul className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                {tracked.map(({ status, job }) => (
                  <li key={job.id}>
                    <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.05]">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{job.title}</p>
                        <p className="truncate text-xs text-white/45">{job.company_name} · {job.location}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="hidden text-sm font-semibold tabular-nums sm:block">{formatRate(job)}</span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
                          status === "applied"
                            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                            : "border-sky-400/30 bg-sky-400/10 text-sky-300"
                        }`}>
                          {status === "applied" ? "Applied" : "Saved"}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Fresh on the board */}
          {latest.length > 0 && (
            <section className="mt-10">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wide text-white/50">Fresh on the board</h2>
                <Link href="/jobs" className="inline-flex items-center gap-1 text-sm text-white/50 transition-colors hover:text-white">
                  View all <ArrowRight size={13} />
                </Link>
              </div>
              <ul className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                {latest.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.05]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{job.title}</p>
                        <p className="truncate text-xs text-white/45">
                          {job.company_name} · {job.location} · {formatPosted(job)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="hidden text-sm font-semibold tabular-nums sm:block">{formatRate(job)}</span>
                        <IR35Chip status={job.ir35_status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
