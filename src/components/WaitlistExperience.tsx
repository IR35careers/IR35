"use client";

import type { ReactElement } from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Briefcase, Sparkles, ArrowRight, Loader2, CheckCircle2, Users, Search, ShieldCheck, PoundSterling } from "lucide-react";
import { validateEmail } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import CountdownTimer from "./CountdownTimer";
import { useAuth } from "@/lib/auth-context";

/**
 * Landing page — light green, matching the app. Keeps the waitlist form,
 * real signup + job counts, featured contracts, and the launch countdown.
 * Public and always accessible (no auto-redirect); signed-in users see a
 * "Dashboard" button instead of "Sign up".
 */
export function WaitlistExperience(): ReactElement {
  const { user } = useAuth();

  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [signupCount, setSignupCount] = useState<number | null>(null);
  const [jobCount, setJobCount] = useState<number | null>(null);
  const [featuredJobs, setFeaturedJobs] = useState<Array<{ id: string; title: string; rate: string; company: string }>>([]);

  // Live board preview: total contracts + 3 featured Outside IR35 roles.
  useEffect(() => {
    let isMounted = true;
    fetch("/api/jobs/search?ir35=outside&per_page=3&sort=rate_high")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { jobs?: Array<{ id: string; title: string; company_name: string; rate_min: number | null; rate_max: number | null; rate_type: string }> } | null) => {
        if (!isMounted || !json) return;
        setFeaturedJobs((json.jobs ?? []).map((j) => ({
          id: j.id,
          title: j.title,
          company: j.company_name,
          rate: j.rate_max !== null || j.rate_min !== null ? `£${(j.rate_max ?? j.rate_min)!.toLocaleString()}${j.rate_type === "hourly" ? "/hr" : "/day"}` : "",
        })));
      })
      .catch(() => undefined);
    fetch("/api/jobs/search?per_page=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { total?: number } | null) => { if (isMounted && json?.total) setJobCount(json.total); })
      .catch(() => undefined);
    return () => { isMounted = false; };
  }, []);

  // Real signup count for social proof (hidden if zero / unavailable).
  useEffect(() => {
    let isMounted = true;
    supabase.from("waitlist_count").select("total").single().then(({ data, error }) => {
      if (!isMounted || error || !data) return;
      setSignupCount(Number(data.total));
    });
    return () => { isMounted = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Please enter your email address.");
    if (!validateEmail(email)) return toast.error("Please enter a valid email address.");
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("waitlist").insert([{ email: email.trim().toLowerCase() }]);
      if (error) {
        toast.error(error.code === "23505" ? "This email is already on the waitlist!" : "Something went wrong. Please try again.");
        setIsSubmitting(false);
        return;
      }
      setIsSubmitted(true);
      toast.success("You're on the list! 🎉");
      setEmail("");
    } catch {
      toast.error("Network error. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const POPULAR: Array<[string, string]> = [
    ["Outside IR35", "/jobs?ir35=outside"],
    ["Remote", "/jobs?remote=remote"],
    ["React", "/jobs?skills=React"],
    ["AWS", "/jobs?skills=AWS"],
    ["DevOps", "/jobs?skills=DevOps"],
    ["£600+/day", "/jobs?min_rate=600"],
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Nav */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-green-600">
              <Briefcase size={15} className="text-white" />
            </div>
            <span className="text-sm font-bold text-slate-900">IR35<span className="text-slate-500">Careers</span></span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/jobs" className="hidden rounded-full px-3.5 py-1.5 text-sm text-slate-600 transition-colors hover:text-slate-900 sm:block">Browse contracts</Link>
            <Link href="/tools" className="hidden rounded-full px-3.5 py-1.5 text-sm text-slate-600 transition-colors hover:text-slate-900 sm:block">Tools</Link>
            {user ? (
              <Link href="/dashboard" className="rounded-full bg-green-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-700">Dashboard</Link>
            ) : (
              <>
                <Link href="/account" className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400">Sign in</Link>
                <Link href="/account" className="rounded-full bg-green-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-700">Sign up</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-[1500px] px-4 py-12 sm:px-6 lg:py-16">
        <div className="grid items-start gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          {/* Left */}
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1">
              <Sparkles size={12} className="text-green-600" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-green-700">Beta is live</span>
            </div>

            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              UK contracts,
              <br />
              <span className="bg-gradient-to-r from-green-600 to-green-500 bg-clip-text text-transparent">IR35 status up front</span>
            </h1>

            <p className="mt-5 max-w-md text-base leading-relaxed text-slate-600">
              Every role labelled Inside or Outside IR35, with day rates shown before you click.
              Pulled live from Reed, Adzuna and employer boards, refreshed through the day.
            </p>

            {/* Trust signals */}
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
              {[[ShieldCheck, "IR35 status upfront"], [PoundSterling, "Day rates shown"], [Briefcase, "Direct to employer"], [Search, "Updated daily"]].map(([Icon, t]) => {
                const I = Icon as typeof ShieldCheck;
                return <span key={t as string} className="inline-flex items-center gap-1.5"><I size={15} className="text-green-600" /> {t as string}</span>;
              })}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/jobs" className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-green-700">
                Browse {jobCount !== null && jobCount > 0 ? jobCount.toLocaleString() : "live"} contracts <ArrowRight size={15} />
              </Link>
              {!user && (
                <Link href="/account" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400">
                  Create free account
                </Link>
              )}
            </div>

            {/* Popular searches */}
            <div className="mt-6">
              <p className="text-xs uppercase tracking-wide text-slate-400">Popular searches</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {POPULAR.map(([label, href]) => (
                  <Link key={label} href={href} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 transition-colors hover:border-green-300 hover:text-green-700">{label}</Link>
                ))}
              </div>
            </div>

            {/* Waitlist + countdown */}
            <div className="mt-8 max-w-md rounded-2xl border border-slate-200 bg-white p-5">
              {!isSubmitted ? (
                <>
                  <p className="text-sm font-semibold text-slate-800">Get launch updates &amp; rate alerts</p>
                  <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email address"
                      className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40" />
                    <button type="submit" disabled={isSubmitting} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60">
                      {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Notify me <ArrowRight size={14} /></>}
                    </button>
                  </form>
                  {signupCount !== null && signupCount > 0 && (
                    <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-500">
                      <Users size={12} /> <span><span className="font-semibold text-slate-700">{signupCount.toLocaleString()}</span> {signupCount === 1 ? "person" : "people"} already signed up</span>
                    </p>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-3 py-1">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-green-300 bg-green-50"><CheckCircle2 className="h-5 w-5 text-green-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">You&apos;re on the list!</p>
                    <p className="text-xs text-slate-500">We&apos;ll email you at launch — browse the board meanwhile.</p>
                  </div>
                </div>
              )}
              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="mb-2 text-[10px] uppercase tracking-widest text-slate-400">Full launch in</p>
                <CountdownTimer />
              </div>
            </div>
          </div>

          {/* Right: live board preview */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                Live on the board
              </p>
              {jobCount !== null && jobCount > 0 && <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-600">{jobCount.toLocaleString()} roles</span>}
            </div>

            {featuredJobs.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {featuredJobs.map((job) => (
                  <li key={job.id}>
                    <Link href={`/jobs/${job.id}`} className="block rounded-xl border border-slate-200 p-3.5 transition-colors hover:border-green-300 hover:bg-green-50/30">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-medium text-slate-900">{job.title}</p>
                        {job.rate && <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{job.rate}</span>}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-xs text-slate-500">{job.company}</p>
                        <span className="shrink-0 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">Outside IR35</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Fresh contracts land here throughout the day.</p>
            )}

            <Link href="/jobs" className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-green-300 hover:text-green-700">
              See all contracts <ArrowRight size={14} />
            </Link>

            {/* Mini how-it-works */}
            <div className="mt-6 grid grid-cols-3 gap-2 border-t border-slate-100 pt-5 text-center">
              {[["1", "Search"], ["2", "See IR35 + rate"], ["3", "Apply direct"]].map(([n, label]) => (
                <div key={n}>
                  <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-green-50 text-xs font-bold text-green-700">{n}</div>
                  <p className="mt-1.5 text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-400">
        Updated daily · Sources: employer career boards, Reed, Adzuna · IR35 status shown only when stated in the original listing
      </footer>
    </div>
  );
}
