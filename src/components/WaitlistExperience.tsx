"use client";

import type { ReactElement } from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Briefcase, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { validateEmail } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import CountdownTimer from "./CountdownTimer";
import { useAuth } from "@/lib/auth-context";

/** Fine film grain, kept very low opacity. Adds depth without visible noise. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

/** Animated count-up for the live contract figure. */
function useCountUp(target: number | null, enabled: boolean, duration = 1100): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === null) return;
    if (!enabled) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, duration]);
  return value;
}

export function WaitlistExperience(): ReactElement {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const reduce = useReducedMotion();

  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [signupCount, setSignupCount] = useState<number | null>(null);
  const [jobCount, setJobCount] = useState<number | null>(null);
  const liveCount = useCountUp(jobCount, !reduce);

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
        toast.error(error.code === "23505" ? "You're already on the list." : "Something went wrong. Please try again.");
        setIsSubmitting(false);
        return;
      }
      setIsSubmitted(true);
      setSignupCount((c) => (c === null ? c : c + 1));
      toast.success("You're on the list.");
      setEmail("");
    } catch {
      toast.error("Network error. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Signed in, or still resolving: neutral splash, never a flash of marketing.
  if (authLoading || user) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-white [color-scheme:light]">
        <Loader2 className="animate-spin text-slate-300" size={24} />
      </div>
    );
  }

  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.7, ease: [0.16, 1, 0.3, 1] as const },
  });

  const drift = (dx: number[], dy: number[], seconds: number) =>
    reduce ? {} : { animate: { x: dx, y: dy }, transition: { duration: seconds, repeat: Infinity, ease: "easeInOut" as const } };

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-white text-slate-900 [color-scheme:light]">
      <style>{`:root{color-scheme:light}`}</style>

      {/* Ambient field */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <motion.div
          className="absolute -top-56 left-1/2 h-[620px] w-[820px] -translate-x-1/2 rounded-full bg-green-200/45 blur-[140px]"
          {...drift([0, 30, -20, 0], [0, 20, -10, 0], 30)}
        />
        <motion.div
          className="absolute -left-40 top-1/3 h-[420px] w-[420px] rounded-full bg-emerald-100/70 blur-[130px]"
          {...drift([0, 40, 0], [0, -30, 0], 36)}
        />
        <motion.div
          className="absolute -right-40 bottom-0 h-[460px] w-[460px] rounded-full bg-teal-100/60 blur-[130px]"
          {...drift([0, -35, 0], [0, 25, 0], 32)}
        />
        <div className="absolute inset-0 opacity-[0.22] mix-blend-soft-light" style={{ backgroundImage: GRAIN }} />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-white to-transparent" />
      </div>

      {/* Nav */}
      <motion.header
        {...rise(0)}
        className="relative z-10 flex h-16 shrink-0 items-center justify-between px-5 sm:h-20 sm:px-10"
      >
        <Link href="/" className="group flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-green-500 to-green-600 shadow-[0_2px_8px_rgba(22,163,74,0.25)]">
            <Briefcase size={15} className="text-white" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">
            IR35<span className="text-slate-400">Careers</span>
          </span>
        </Link>
        <Link
          href="/account"
          className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-[13px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] backdrop-blur transition-all hover:-translate-y-px hover:border-slate-300 hover:shadow-[0_4px_12px_rgba(16,24,40,0.06)]"
        >
          Sign in / Sign up
        </Link>
      </motion.header>

      {/* Hero */}
      <main className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-5 sm:px-8">
        <div className="w-full max-w-3xl text-center">
          <motion.span
            {...rise(0.05)}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/80 px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)] backdrop-blur"
          >
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
            </span>
            Private beta, opening soon
          </motion.span>

          <motion.h1
            {...rise(0.12)}
            className="mt-5 text-[2rem] font-semibold leading-[1.04] tracking-[-0.035em] sm:mt-6 sm:text-[3.4rem] lg:text-[4rem]"
          >
            Stop hunting six job boards
            <br className="hidden sm:block" />{" "}
            <span className="bg-gradient-to-br from-green-600 via-green-500 to-emerald-600 bg-clip-text text-transparent">
              for one contract.
            </span>
          </motion.h1>

          <motion.p
            {...rise(0.2)}
            className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-slate-600 sm:mt-5 sm:text-[17px]"
          >
            Every UK contract in one place, with IR35 status and day rate shown before you click.
            Be first to see new roles, and apply direct.
          </motion.p>

          {/* Capture */}
          <motion.div {...rise(0.28)} className="mx-auto mt-6 max-w-md sm:mt-7">
            {!isSubmitted ? (
              <form onSubmit={handleSubmit} className="group flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email address"
                  className="min-w-0 flex-1 rounded-full border border-slate-200 bg-white/90 px-5 py-3.5 text-sm shadow-[0_1px_2px_rgba(16,24,40,0.04)] backdrop-blur transition-all placeholder:text-slate-400 focus:border-green-500 focus:shadow-[0_0_0_4px_rgba(34,197,94,0.10)] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-[0_8px_22px_rgba(15,23,42,0.22)] active:translate-y-0 disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Get early access <ArrowRight size={15} /></>}
                </button>
              </form>
            ) : (
              <motion.div
                initial={reduce ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center justify-center gap-2.5 rounded-2xl border border-green-200 bg-green-50/90 px-5 py-3.5 backdrop-blur"
              >
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                <p className="text-sm font-medium text-green-800">
                  You&apos;re on the list. We&apos;ll email you when access opens.
                </p>
              </motion.div>
            )}

            <p className="mt-3 text-xs text-slate-500">
              {signupCount !== null && signupCount > 0 && (
                <><span className="font-semibold text-slate-700">{signupCount.toLocaleString()}</span> contractors joined <span className="mx-1 text-slate-300">·</span> </>
              )}
              7 days free, then £9.99/mo at launch
            </p>
          </motion.div>

          {/* Countdown */}
          <motion.div {...rise(0.36)} className="mx-auto mt-7 max-w-xs sm:mt-8">
            <p className="mb-2.5 text-[10px] font-medium uppercase tracking-[0.22em] text-slate-400">
              Full launch in
            </p>
            <CountdownTimer />
          </motion.div>

          {/* Live proof */}
          {jobCount !== null && jobCount > 0 && (
            <motion.p {...rise(0.46)} className="mt-6 text-[13px] text-slate-500 sm:mt-7">
              <span className="font-semibold tabular-nums text-slate-800">{liveCount.toLocaleString()}</span> live UK contracts on the board today
              <span className="mx-1.5 text-slate-300">·</span>
              <Link href="/contracts/outside-ir35-contracts" className="font-medium text-green-700 underline-offset-4 transition-colors hover:text-green-800 hover:underline">
                preview roles
              </Link>
            </motion.p>
          )}
        </div>
      </main>

      {/* Foot */}
      <motion.footer
        {...rise(0.54)}
        className="relative z-10 hidden shrink-0 border-t border-slate-100 px-5 py-4 sm:px-10 min-[700px]:block"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[12px] text-slate-500">
          {["Every UK contract, one board", "IR35 status and day rate up front", "Apply direct to the client"].map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-green-600" /> {p}
            </span>
          ))}
          <span className="hidden text-slate-200 lg:inline">|</span>
          <Link href="/tools" className="transition-colors hover:text-slate-800">Free tools</Link>
          <Link href="/resources" className="transition-colors hover:text-slate-800">IR35 guides</Link>
        </div>
      </motion.footer>
    </div>
  );
}
