"use client";

import type { ReactElement } from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, ArrowRight, Loader2, CheckCircle2, Check } from "lucide-react";
import { validateEmail } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import CountdownTimer from "./CountdownTimer";
import { useAuth } from "@/lib/auth-context";

/**
 * Landing page — minimal waitlist design: one story, one action.
 * Signed-in users are sent straight to their dashboard.
 */
export function WaitlistExperience(): ReactElement {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [signupCount, setSignupCount] = useState<number | null>(null);
  const [jobCount, setJobCount] = useState<number | null>(null);

  // Signed in → straight to the app.
  useEffect(() => {
    if (!authLoading && user) router.replace("/dashboard");
  }, [user, authLoading, router]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/jobs/search?per_page=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { total?: number } | null) => { if (mounted && j?.total) setJobCount(j.total); })
      .catch(() => undefined);
    supabase.from("waitlist_count").select("total").single().then(({ data, error }) => {
      if (!mounted || error || !data) return;
      setSignupCount(Number(data.total));
    });
    return () => { mounted = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Please enter your email address.");
    if (!validateEmail(email)) return toast.error("Please enter a valid email address.");
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("waitlist").insert([{ email: email.trim().toLowerCase() }]);
      if (error) {
        toast.error(error.code === "23505" ? "You're already on the list!" : "Something went wrong. Please try again.");
        setIsSubmitting(false);
        return;
      }
      setIsSubmitted(true);
      setSignupCount((c) => (c === null ? c : c + 1));
      toast.success("You're on the list 🎉");
      setEmail("");
    } catch {
      toast.error("Network error. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const STORY = [
    {
      k: "The problem",
      t: "Six tabs, one contract",
      b: "Contracts are scattered across Reed, Jobserve, LinkedIn and a dozen agency sites. IR35 status is buried in paragraph six — or missing entirely.",
    },
    {
      k: "What we built",
      t: "One board, status up front",
      b: "Every UK contract in one place, each labelled Inside or Outside IR35 — only when the advert says so — with the day rate shown before you click.",
    },
    {
      k: "What you get",
      t: "First look, less noise",
      b: "Match scores from your own skills, saved searches, and one place to track everything you've applied for. Applications go direct to the client.",
    },
  ];

  const PLAN = [
    "Every UK contract, IR35 status shown",
    "Day rates up front — no guessing",
    "Match scores from your CV & skills",
    "Saved searches and application tracking",
    "Apply direct — no middleman",
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 [color-scheme:light]">
      <style>{`:root{color-scheme:light}`}</style>

      {/* Nav */}
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-green-600">
            <Briefcase size={15} className="text-white" />
          </div>
          <span className="text-sm font-bold">IR35<span className="text-slate-400">Careers</span></span>
        </Link>
        <Link href="/account" className="text-sm text-slate-500 transition-colors hover:text-slate-900">
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <main>
        <section className="relative overflow-hidden px-5 pb-20 pt-10 sm:px-8 sm:pt-16">
          {/* soft glow */}
          <div className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-green-100/60 blur-[130px]" aria-hidden />

          <div className="relative mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
              </span>
              Private beta · Opening soon
            </span>

            <h1 className="mt-7 text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Stop hunting six job boards
              <br className="hidden sm:block" />{" "}
              for <span className="text-green-600">one contract.</span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
              IR35Careers brings every UK contract into one place — IR35 status and day rate shown
              before you click. Be first to see new roles, and apply direct.
            </p>

            {/* Email capture */}
            <div className="mx-auto mt-9 max-w-md">
              {!isSubmitted ? (
                <form onSubmit={handleSubmit} className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    aria-label="Email address"
                    className="min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-5 py-3.5 text-sm placeholder:text-slate-400 focus:border-green-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/30"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Get early access <ArrowRight size={15} /></>}
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-5 py-4">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                  <p className="text-sm font-medium text-green-800">
                    You&apos;re on the list — we&apos;ll email you the moment access opens.
                  </p>
                </div>
              )}

              <p className="mt-3 text-xs text-slate-500">
                {signupCount !== null && signupCount > 0 && (
                  <><span className="font-semibold text-slate-700">{signupCount.toLocaleString()}</span> contractors already joined · </>
                )}
                Free while in beta
              </p>
            </div>

            {/* Countdown */}
            <div className="mx-auto mt-12 max-w-md rounded-2xl border border-slate-200 bg-white/70 p-5 backdrop-blur">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Full launch in
              </p>
              <CountdownTimer />
            </div>

            {/* Live proof */}
            {jobCount !== null && jobCount > 0 && (
              <p className="mt-8 text-sm text-slate-500">
                <span className="font-semibold text-slate-800">{jobCount.toLocaleString()}</span> live UK contracts on the board today ·{" "}
                <Link href="/contracts/outside-ir35-contracts" className="font-medium text-green-700 underline-offset-4 hover:underline">
                  preview Outside IR35 roles
                </Link>
              </p>
            )}
          </div>
        </section>

        {/* Story */}
        <section className="border-t border-slate-100 px-5 py-20 sm:px-8">
          <div className="mx-auto grid max-w-5xl gap-10 sm:grid-cols-3">
            {STORY.map((s) => (
              <div key={s.k}>
                <p className="text-xs font-semibold uppercase tracking-widest text-green-600">{s.k}</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight">{s.t}</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{s.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Founding offer */}
        <section className="border-t border-slate-100 px-5 py-20 sm:px-8">
          <div className="mx-auto max-w-md">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-green-600">Founding member</p>
              <div className="mt-3 flex items-end gap-1.5">
                <span className="text-4xl font-semibold tracking-tight">£9.99</span>
                <span className="pb-1.5 text-sm text-slate-500">/month at launch</span>
              </div>
              <p className="mt-1.5 text-sm text-slate-600">
                First 7 days free. Join the waitlist now and lock in founding-member pricing.
              </p>

              <ul className="mt-6 space-y-2.5">
                {PLAN.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <Check size={16} className="mt-0.5 shrink-0 text-green-600" /> {f}
                  </li>
                ))}
              </ul>

              <a
                href="#top"
                onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
              >
                Join the waitlist <ArrowRight size={15} />
              </a>
              <p className="mt-3 text-center text-xs text-slate-400">
                Nothing to pay today — the board is free while in beta.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100 px-5 py-10 text-center text-xs text-slate-400 sm:px-8">
        <p>
          Sources: employer career boards, Reed, Adzuna · IR35 status shown only when stated in the
          original listing · Updated through the day
        </p>
        <p className="mt-2">
          <Link href="/tools" className="hover:text-slate-600">Free tools</Link>
          <span className="mx-2">·</span>
          <Link href="/resources" className="hover:text-slate-600">IR35 guides</Link>
        </p>
      </footer>
    </div>
  );
}
