"use client";

import Link from "next/link";
import { ArrowRight, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function HomeScrollProgress() {
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const root = document.documentElement;
      const total = Math.max(root.scrollHeight - window.innerHeight, 1);
      const progress = Math.min(Math.max(window.scrollY / total, 0), 1);
      progressRef.current?.style.setProperty("transform", `scaleX(${progress})`);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={progressRef}
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-gradient-to-r from-brand-500 via-emerald-400 to-teal-400"
      style={{ transform: "scaleX(0)", willChange: "transform" }}
    />
  );
}

export function HomeStickyCta() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = document.getElementById("home-primary-actions");
    if (!target) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: "-80px 0px 0px", threshold: 0.15 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 transition-[opacity,transform] duration-200 motion-reduce:transition-none md:hidden ${visible ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none translate-y-5 opacity-0"}`}
    >
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-white/80 bg-[#071426]/95 p-2 pl-4 text-white shadow-floating backdrop-blur-xl">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">Find your next contract</p>
          <p className="truncate text-[11px] text-slate-300">Browse free. Apply when you are ready.</p>
        </div>
        <Link
          href="/jobs"
          className="ir35-focus inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-emerald-300 px-4 text-sm font-bold text-slate-950"
        >
          Browse <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

const SOURCE_NAMES = [
  "Adzuna",
  "Greenhouse",
  "Workable",
  "Ashby",
  "SmartRecruiters",
  "Reed",
  "Totaljobs",
] as const;

export function HomeSourceRail() {
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  const isPaused = paused || reduceMotion;

  return (
    <div className="ir35-source-rail">
      <div className="ir35-source-rail-heading">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.17em] text-brand-700">Public contract sources</p>
          <p className="mt-1 text-xs text-slate-500">Fresh roles from job boards and employer application systems</p>
        </div>
        <button
          type="button"
          onClick={() => setPaused((current) => !current)}
          className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-emerald-200 hover:text-brand-700"
          aria-pressed={isPaused}
          aria-label={isPaused ? "Resume source list movement" : "Pause source list movement"}
        >
          {isPaused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
          {isPaused ? "Play" : "Pause"}
        </button>
      </div>
      <div className="ir35-source-marquee-mask mt-4">
        <div className={`ir35-source-marquee-track ${isPaused ? "is-paused" : ""}`}>
          {[...Array(2)].flatMap((_, group) => SOURCE_NAMES.map((source, index) => (
            <span key={`${group}-${source}`} className="ir35-source-mark" aria-hidden={group === 1}>
              <span className={`ir35-source-mark-symbol ir35-source-mark-symbol-${(index % 4) + 1}`} aria-hidden="true">
                {source.slice(0, 1)}
              </span>
              <span>{source}</span>
            </span>
          )))}
        </div>
      </div>
      <p className="sr-only">Sources include {SOURCE_NAMES.join(", ")}.</p>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">Source names identify listing technology or job boards. No partnership or endorsement is implied.</p>
    </div>
  );
}
