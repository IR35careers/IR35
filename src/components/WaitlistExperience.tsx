"use client";

import type { ReactElement } from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { validateEmail } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import CountdownTimer from "./CountdownTimer";
import { useAuth } from "@/lib/auth-context";

/**
 * Landing page — single viewport, no scrolling. One story, one action.
 * Signed-in users go straight to their dashboard.
 *
 * Height strategy: the page is locked to one screen (100dvh, overflow hidden).
 * On very short screens the bottom strip is hidden rather than clipped, so the
 * headline, email capture and countdown always remain reachable.
 */
export function WaitlistExperience(): ReactElement {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [signupCount, setSignupCount] = useState<number | null>(null);
  const [jobCount, setJobCount] = useState<number | null>(null);

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

  const POINTS = [
    "Every UK contract, one board",
    "IR35 status & day rate up front",
    "Apply direct to the client",
  ];

  // Signed in (or still resolving): show a neutral splash rather than a flash
  // of the marketing page before the dashboard redirect lands.
  if (authLoading || user) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-white [color-scheme:light]">
        <Loader2 className="animate-spin text-slate-300" size={24} />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-white text-slate-900 [color-scheme:light]">
      <style>{`:root{color-scheme:light}`}</style>

      {/* Nav */}
      <header className="flex h-16 shrink-0 items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-green-600">
            <Briefcase size={15} className="text-white" />
          </div>
          <span className="text-sm font-bold">IR35<span className="text-slate-400">Careers</span></span>
        </Link>
        <Link
          href="/account"
          className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900"
        >
          Sign in / Sign up
        </Link>
      </header>

      {/* Hero — fills remaining height, centred */}
      <main className="relative flex min-h-0 flex-1 items-center justify-center px-5 sm:px-8">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[360px] w-[760px] -translate-x-1/2 rounded-full bg-green-100/60 blur-[130px]" aria-hidden />

        <div className="relative w-full max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
            </span>
            Private beta · Opening soon
          </span>

          <h1 className="mt-4 text-[1.9rem] font-semibold leading-[1.08] tracking-tight sm:mt-5 sm:text-5xl lg:text-[3.4rem]">
            Stop hunting six job boards
            <br className="hidden sm:block" />{" "}
            for <span className="text-green-600">one contract.</span>
          </h1>

          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-600 sm:mt-4 sm:text-base">
            Every UK contract in one place, with IR35 status and day rate shown before you click.
            Be first to see new roles, and apply direct.
          </p>

          {/* Email capture */}
          <div className="mx-auto mt-5 max-w-md sm:mt-6">
            {!isSubmitted ? (
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email address"
                  className="min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm placeholder:text-slate-400 focus:border-green-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/30"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 sm:px-6"
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Get early access <ArrowRight size={15} /></>}
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                <p className="text-sm font-medium text-green-800">
                  You&apos;re on the list. We&apos;ll email you when access opens.
                </p>
              </div>
            )}

            <p className="mt-2.5 text-xs text-slate-500">
              {signupCount !== null && signupCount > 0 && (
                <><span className="font-semibold text-slate-700">{signupCount.toLocaleString()}</span> contractors joined · </>
              )}
              7 days free, then £9.99/mo at launch
            </p>
          </div>

          {/* Countdown */}
          <div className="mx-auto mt-6 max-w-sm sm:mt-7">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Full launch in
            </p>
            <CountdownTimer />
          </div>

          {/* Live proof */}
          {jobCount !== null && jobCount > 0 && (
            <p className="mt-5 text-xs text-slate-500 sm:mt-6 sm:text-sm">
              <span className="font-semibold text-slate-800">{jobCount.toLocaleString()}</span> live UK contracts on the board today ·{" "}
              <Link href="/contracts/outside-ir35-contracts" className="font-medium text-green-700 underline-offset-4 hover:underline">
                preview roles
              </Link>
            </p>
          )}
        </div>
      </main>

      {/* Bottom strip — hidden on very short screens so nothing gets clipped */}
      <footer className="hidden shrink-0 border-t border-slate-100 px-5 py-4 sm:px-8 min-[700px]:block">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs text-slate-500">
          {POINTS.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5">
              <span className="text-green-600">✓</span> {p}
            </span>
          ))}
          <span className="hidden text-slate-300 lg:inline">|</span>
          <Link href="/tools" className="hover:text-slate-800">Free tools</Link>
          <Link href="/resources" className="hover:text-slate-800">IR35 guides</Link>
        </div>
      </footer>
    </div>
  );
}
