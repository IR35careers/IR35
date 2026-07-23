"use client";

import type { ReactElement } from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Briefcase, ArrowRight, Loader2, CheckCircle2, Check } from "lucide-react";
import { validateEmail } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import CountdownTimer from "./CountdownTimer";
import { useAuth } from "@/lib/auth-context";

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

function useCountUp(target: number | null, enabled: boolean, duration = 1100): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === null) return;
    if (!enabled) { setValue(target); return; }
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

  const POINTS = [
    "Every UK contract, one board",
    "IR35 status and day rate up front",
    "Apply direct to the client",
  ];

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-white text-slate-900 [color-scheme:light] lg:h-[100dvh] lg:overflow-hidden">
      <style>{`:root{color-scheme:light}`}</style>

      {/* Ambient field */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <motion.div
          className="absolute -left-56 -top-40 h-[560px] w-[560px] rounded-full bg-green-200/40 blur-[150px]"
          {...drift([0, 40, -20, 0], [0, 25, -15, 0], 32)}
        />
        <motion.div
          className="absolute -right-40 top-1/4 h-[520px] w-[520px] rounded-full bg-emerald-100/60 blur-[140px]"
          {...drift([0, -35, 0], [0, 30, 0], 38)}
        />
        <div className="absolute inset-0 opacity-[0.2] mix-blend-soft-light" style={{ backgroundImage: GRAIN }} />
      </div>

      {/* Nav */}
      <motion.header
        {...rise(0)}
        className="relative z-10 flex h-16 shrink-0 items-center justify-between px-6 sm:h-20 sm:px-10"
      >
        <Link href="/" className="flex items-center gap-2.5">
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

      {/* Two columns: story left, action right */}
      <main className="relative z-10 flex min-h-0 flex-1 items-center px-6 py-10 sm:px-10 lg:py-0">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          {/* Left */}
          <div>
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
              className="mt-6 text-[2.1rem] font-semibold leading-[1.06] tracking-[-0.035em] sm:text-[2.9rem] lg:text-[3.15rem]"
            >
              Stop hunting six job boards for{" "}
              <span className="bg-gradient-to-br from-green-600 via-green-500 to-emerald-600 bg-clip-text text-transparent">
                one contract.
              </span>
            </motion.h1>

            <motion.p
              {...rise(0.2)}
              className="mt-5 max-w-lg text-[15px] leading-relaxed text-slate-600 sm:text-[17px]"
            >
              Every UK contract in one place, with IR35 status and day rate shown before you click.
              Be first to see new roles, and apply direct.
            </motion.p>

            <motion.ul {...rise(0.28)} className="mt-7 space-y-2.5">
              {POINTS.map((p) => (
                <li key={p} className="flex items-center gap-2.5 text-[14px] text-slate-700">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-50">
                    <Check size={12} className="text-green-600" />
                  </span>
                  {p}
                </li>
              ))}
            </motion.ul>

            <motion.p {...rise(0.36)} className="mt-7 text-[13px] text-slate-400">
              <Link href="/tools" className="transition-colors hover:text-slate-700">Free tools</Link>
              <span className="mx-2 text-slate-200">|</span>
              <Link href="/resources" className="transition-colors hover:text-slate-700">IR35 guides</Link>
            </motion.p>
          </div>

          {/* Right: action card */}
          <motion.div
            {...rise(0.24)}
            className="rounded-[26px] border border-slate-200/80 bg-white/85 p-7 shadow-[0_2px_4px_rgba(16,24,40,0.03),0_16px_48px_-12px_rgba(16,24,40,0.10)] backdrop-blur-xl sm:p-8"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Get early access
            </p>

            {!isSubmitted ? (
              <form onSubmit={handleSubmit} className="mt-4 space-y-2.5">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email address"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all placeholder:text-slate-400 focus:border-green-500 focus:shadow-[0_0_0_4px_rgba(34,197,94,0.10)] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-[0_8px_22px_rgba(15,23,42,0.22)] active:translate-y-0 disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Join the waitlist <ArrowRight size={15} /></>}
                </button>
              </form>
            ) : (
              <motion.div
                initial={reduce ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="mt-4 flex items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3.5"
              >
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                <p className="text-sm font-medium text-green-800">
                  You&apos;re on the list. We&apos;ll email you when access opens.
                </p>
              </motion.div>
            )}

            <p className="mt-3 text-xs text-slate-500">
              {signupCount !== null && signupCount > 0 && (
                <><span className="font-semibold text-slate-700">{signupCount.toLocaleString()}</span> contractors joined<span className="mx-1.5 text-slate-300">·</span></>
              )}
              7 days free, then £9.99/mo at launch
            </p>

            <div className="mt-6 border-t border-slate-100 pt-5">
              <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.22em] text-slate-400">
                Full launch in
              </p>
              <CountdownTimer />
            </div>

            {jobCount !== null && jobCount > 0 && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-[13px] text-slate-500">
                  <span className="font-semibold tabular-nums text-slate-800">{liveCount.toLocaleString()}</span> live UK contracts today
                  <span className="mx-1.5 text-slate-300">·</span>
                  <Link href="/contracts/outside-ir35-contracts" className="font-medium text-green-700 underline-offset-4 transition-colors hover:text-green-800 hover:underline">
                    preview roles
                  </Link>
                </p>
              </div>
            )}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
