"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  Search,
  Sparkles,
  Target,
  X,
} from "lucide-react";

type TourMode = "closed" | "tour" | "returning";

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  viewportWidth: number;
}

const TOUR_STEPS = [
  {
    target: null,
    icon: Sparkles,
    eyebrow: "Welcome to IR35Careers",
    title: "Your contractor workspace starts here",
    body: "Find relevant UK contracts, prepare evidence-led applications and track every response from one dashboard. This quick tour takes less than a minute.",
  },
  {
    target: "dashboard-search",
    icon: Search,
    eyebrow: "Find",
    title: "Search the roles that fit you",
    body: "Search by role, skill or company. Your saved profile adds transparent match scores, rate fit, workplace preference and IR35 context.",
  },
  {
    target: "application-journey",
    icon: Target,
    eyebrow: "Prepare and apply",
    title: "Follow one clear application path",
    body: "Move from profile to role, CV improvements, approval, submission and tracking. Supported employer connections submit your approved application from IR35Careers and return a receipt.",
  },
  {
    target: "profile-progress",
    icon: FileCheck2,
    eyebrow: "Your evidence",
    title: "Build matches from facts, never guesses",
    body: "Add your real skills, preferences and CV. Suggested changes stay reviewable and IR35Careers never invents experience or submits an unapproved packet.",
  },
] as const;

function findVisibleTarget(name: string): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`));
  return candidates.find((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }) ?? null;
}

export function WelcomeModal({ name, userId }: { name?: string; userId: string }) {
  const [mode, setMode] = useState<TourMode>("closed");
  const [stepIndex, setStepIndex] = useState(0);
  const [highlight, setHighlight] = useState<HighlightRect | null>(null);
  const tourKey = useMemo(() => `ir35careers:dashboard-tour:v2:${userId}`, [userId]);
  const sessionKey = useMemo(() => `ir35careers:welcome-back:v1:${userId}`, [userId]);

  const finishTour = useCallback(() => {
    try {
      window.localStorage.setItem(tourKey, "complete");
      window.sessionStorage.setItem(sessionKey, "1");
    } catch {
      /* A blocked storage API should not trap the user in the tour. */
    }
    setMode("closed");
    setHighlight(null);
  }, [sessionKey, tourKey]);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(tourKey)) {
        setMode("tour");
        return;
      }
      if (!window.sessionStorage.getItem(sessionKey)) {
        window.sessionStorage.setItem(sessionKey, "1");
        setMode("returning");
      }
    } catch {
      setMode("closed");
    }
  }, [sessionKey, tourKey]);

  useEffect(() => {
    if (mode !== "returning") return;
    const timer = window.setTimeout(() => setMode("closed"), 5_000);
    return () => window.clearTimeout(timer);
  }, [mode]);

  useEffect(() => {
    if (mode !== "tour") {
      setHighlight(null);
      return;
    }

    const targetName = TOUR_STEPS[stepIndex].target;
    if (!targetName) {
      setHighlight(null);
      return;
    }

    const target = findVisibleTarget(targetName);
    if (!target) {
      setHighlight(null);
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });

    const update = () => {
      const rect = target.getBoundingClientRect();
      setHighlight({
        top: Math.max(8, rect.top - 6),
        left: Math.max(8, rect.left - 6),
        width: Math.min(window.innerWidth - 16, rect.width + 12),
        height: rect.height + 12,
        viewportWidth: window.innerWidth,
      });
    };

    const frame = window.requestAnimationFrame(update);
    const settle = window.setTimeout(update, reducedMotion ? 0 : 350);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [mode, stepIndex]);

  useEffect(() => {
    if (mode !== "tour") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finishTour();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finishTour, mode]);

  if (mode === "closed") return null;

  if (mode === "returning") {
    return (
      <div className="fixed bottom-4 right-4 z-[70] w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-emerald-200 bg-white p-4 shadow-2xl" role="status" aria-live="polite">
        <button type="button" onClick={() => setMode("closed")} aria-label="Dismiss welcome message" className="ir35-focus absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={16} aria-hidden="true" />
        </button>
        <div className="flex gap-3 pr-8">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 size={19} aria-hidden="true" /></span>
          <div>
            <p className="font-semibold text-slate-950">Welcome back{name ? `, ${name}` : ""}.</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">Your dashboard, saved contracts and application progress are ready.</p>
          </div>
        </div>
      </div>
    );
  }

  const step = TOUR_STEPS[stepIndex];
  const StepIcon = step.icon;
  const lastStep = stepIndex === TOUR_STEPS.length - 1;
  const panelSide = highlight && highlight.left + highlight.width / 2 > highlight.viewportWidth / 2 ? "left-4 sm:left-6" : "right-4 sm:right-6";

  return (
    <>
      {highlight ? (
        <div
          className="pointer-events-none fixed z-[60] rounded-2xl ring-2 ring-emerald-300 transition-all duration-200"
          style={{
            top: highlight.top,
            left: highlight.left,
            width: highlight.width,
            height: highlight.height,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.58)",
          }}
          aria-hidden="true"
        />
      ) : (
        <div className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-[2px]" aria-hidden="true" />
      )}

      <section
        className={`fixed z-[70] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl ${highlight ? `bottom-4 sm:bottom-6 ${panelSide}` : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-tour-title"
      >
        <div className="border-b border-slate-100 bg-gradient-to-br from-slate-950 to-emerald-950 px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-300/15 text-emerald-300"><StepIcon size={21} aria-hidden="true" /></span>
            <button type="button" onClick={finishTour} className="ir35-focus min-h-9 rounded-lg px-2 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white">Skip tour</button>
          </div>
          <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">{step.eyebrow}</p>
          <h2 id="dashboard-tour-title" className="mt-1 text-xl font-semibold tracking-tight">{step.title}</h2>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm leading-6 text-slate-600">{step.body}</p>
          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-xs font-semibold tabular-nums text-slate-500">{stepIndex + 1} of {TOUR_STEPS.length}</p>
            <div className="flex gap-2">
              {stepIndex > 0 && (
                <button type="button" onClick={() => setStepIndex((current) => current - 1)} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <ArrowLeft size={15} aria-hidden="true" /> Back
                </button>
              )}
              <button type="button" onClick={() => lastStep ? finishTour() : setStepIndex((current) => current + 1)} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
                {lastStep ? "Explore dashboard" : "Next"} {lastStep ? <CheckCircle2 size={15} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {lastStep && (
            <Link href="/onboarding" onClick={finishTour} className="ir35-focus mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
              Set up my profile now
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
