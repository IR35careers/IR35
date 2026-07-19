"use client";

/**
 * /dashboard — the signed-in home.
 *
 * Personalized: time-aware greeting by name, CV on file, and "Top matches"
 * with percentage scores from the profile-vs-job scoring engine. New users
 * without a profile are routed straight into onboarding.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Loader2,
  Search,
  FileText,
  LogOut,
  Settings2,
  MapPin,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { formatRate } from "@/lib/job-types";
import {
  fetchMatches,
  firstName,
  getProfile,
  timeGreeting,
  type Profile,
  type ScoredJob,
} from "@/lib/profile";

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-300 border-emerald-400/40 bg-emerald-400/10";
  if (score >= 50) return "text-sky-300 border-sky-400/40 bg-sky-400/10";
  return "text-white/60 border-white/20 bg-white/5";
}

export default function DashboardPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [matches, setMatches] = useState<ScoredJob[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/account?next=/dashboard");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    getProfile(user.id).then((p) => {
      setProfile(p);
      setProfileChecked(true);
      // Brand-new account with no profile at all → onboarding.
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

  if (loading || !user || !profileChecked || (profileChecked && !profile)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white/50">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  const name = firstName(profile, user.email ?? undefined);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-black text-white">
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="absolute -top-40 right-[-10%] h-[440px] w-[440px] rounded-full bg-emerald-500/[0.09] blur-[120px]" />
        <div className="absolute bottom-[-15%] left-[-10%] h-[440px] w-[440px] rounded-full bg-sky-500/[0.08] blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-white/30 hover:text-white"
          >
            IR35Careers
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70 transition-colors hover:border-white/30 hover:text-white"
            >
              <Settings2 size={13} /> Edit profile
            </Link>
            <button
              onClick={() => signOut()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70 transition-colors hover:border-white/30 hover:text-white"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>

        {/* Greeting */}
        <header className="mt-8">
          <h1 className="text-3xl font-light tracking-tight sm:text-4xl">
            {timeGreeting()},{" "}
            <span className="bg-gradient-to-r from-emerald-300 to-sky-300 bg-clip-text text-transparent">
              {name}
            </span>
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/50">
            {profile?.cv_filename ? (
              <span className="inline-flex items-center gap-1.5">
                <FileText size={13} className="text-emerald-300" /> CV on file:{" "}
                <span className="text-white/70">{profile.cv_filename}</span>
              </span>
            ) : (
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-1.5 text-emerald-300 underline-offset-4 hover:underline"
              >
                <FileText size={13} /> Upload your CV to complete your profile
              </Link>
            )}
            {profile && profile.skills.length > 0 && (
              <span>
                {profile.skills.length} skill{profile.skills.length === 1 ? "" : "s"} tracked
              </span>
            )}
          </p>
        </header>

        {/* Matches */}
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-white/50">
              <Sparkles size={14} className="text-emerald-300" /> Top matches for you
            </h2>
            <Link
              href="/jobs"
              className="inline-flex items-center gap-1 text-sm text-white/50 transition-colors hover:text-white"
            >
              Search all <Search size={13} />
            </Link>
          </div>

          {profile && profile.skills.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-white/80">Add your skills to unlock matches.</p>
              <Link
                href="/onboarding"
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                Complete profile <ArrowRight size={14} />
              </Link>
            </div>
          ) : matchesLoading ? (
            <div className="mt-8 flex justify-center text-white/50">
              <Loader2 className="animate-spin" size={20} />
            </div>
          ) : matches.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-white/80">No matches for your skills yet.</p>
              <p className="mt-1 text-sm text-white/50">
                New contracts arrive through the day — or broaden your skills in your profile.
              </p>
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {matches.map(({ job, score, matchedSkills }) => (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 pl-6 transition-all hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.07]"
                  >
                    <span
                      className={`absolute inset-y-0 left-0 w-[3px] ${
                        job.ir35_status === "outside"
                          ? "bg-emerald-400/70"
                          : job.ir35_status === "inside"
                            ? "bg-sky-400/70"
                            : "bg-white/10"
                      }`}
                      aria-hidden
                    />
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 text-sm font-medium leading-snug text-white">
                        {job.title}
                      </h3>
                      <span
                        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-xs font-bold tabular-nums ${scoreColor(score)}`}
                        title={`Match score: ${score}%`}
                      >
                        {score}%
                      </span>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-white/50">
                      {job.company_name}
                      <span aria-hidden>·</span>
                      <MapPin size={11} /> {job.location}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {matchedSkills.slice(0, 4).map((s) => (
                        <span
                          key={s}
                          className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-3">
                      <span className="text-sm font-semibold tabular-nums">{formatRate(job)}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          job.ir35_status === "outside"
                            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                            : job.ir35_status === "inside"
                              ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
                              : "border-white/15 bg-white/5 text-white/45"
                        }`}
                      >
                        {job.ir35_status === "outside"
                          ? "Outside IR35"
                          : job.ir35_status === "inside"
                            ? "Inside IR35"
                            : "IR35: TBC"}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
