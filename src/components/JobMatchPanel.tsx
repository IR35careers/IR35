"use client";

/**
 * JobMatchPanel — shows the signed-in user's real (rule-based) match score
 * for this job, with the matched skills. Hidden for signed-out visitors, who
 * see a prompt to sign in. Honest: this is the same skills/rate/IR35 scoring
 * used across the app — labelled "match", not "AI".
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart3, CheckCircle2, CircleOff, Sparkles, WandSparkles } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getProfile, PREVIEW_PROFILE, scoreJob, type ScoredJob } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import type { JobListing } from "@/lib/job-types";

export function JobMatchPanel({ job, showTailorAction = true }: { job: JobListing; showTailorAction?: boolean }) {
  const { user, loading } = useAuth();
  const preview = !isSupabaseConfigured();
  const [result, setResult] = useState<ScoredJob | "profile_empty" | "no_overlap" | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    setReady(false);
    if (preview) {
      setResult(scoreJob(job, PREVIEW_PROFILE) ?? "no_overlap");
      setReady(true);
      return;
    }
    if (!user) {
      setResult(null);
      setReady(true);
      return;
    }
    void getProfile(user.id).then((p) => {
      if (!active) return;
      if (p && p.skills.length > 0) {
        const scored = scoreJob(job, p);
        setResult(scored ?? "no_overlap");
      } else {
        setResult("profile_empty");
      }
      setReady(true);
    });
    return () => { active = false; };
  }, [user, job, preview]);

  if ((!preview && loading) || !ready) return null;

  if (!user && !preview) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Sparkles size={15} className="text-green-600" /> Your match score
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Sign in to see how well this contract matches your skills and preferences.
        </p>
        <Link
          href={`/account?next=/jobs/${job.id}`}
          prefetch={false}
          className="ir35-focus mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Sign in to see match
        </Link>
      </div>
    );
  }

  if (result === "profile_empty") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Sparkles size={15} className="text-green-600" /> Your match score
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Add skills to your profile to see how this contract matches you.
        </p>
        <Link href="/profile#application-readiness" className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400">
          Complete profile
        </Link>
      </div>
    );
  }

  if (result === "no_overlap") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><CircleOff size={15} className="text-slate-500" /> No structured skill overlap</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">Your profile has skills, but none appear in this listing&apos;s structured skill tags. IR35Careers withholds the percentage instead of presenting a misleading score.</p>
        <Link href={`/jobs/${job.id}/resume`} className="ir35-focus mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand-300 bg-brand-50 px-4 text-sm font-semibold text-brand-800"><WandSparkles size={15} />Analyse the full description</Link>
      </div>
    );
  }

  if (!result) return null;

  const r = 34;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - result.score / 100);
  const color = result.score >= 75 ? "#16a34a" : result.score >= 50 ? "#4ade80" : "#94a3b8";
  const verdict = result.score >= 75 ? "Great match" : result.score >= 50 ? "Good match" : "Partial match";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Sparkles size={15} className="text-green-600" /> Your match score
      </p>
      <div className="mt-3 flex items-center gap-4">
        <span className="relative inline-flex h-20 w-20 items-center justify-center">
          <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
            <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
            <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
          </svg>
          <span className="absolute text-lg font-bold tabular-nums text-slate-900">{result.score}%</span>
        </span>
        <div>
          <p className="text-lg font-bold text-green-700">{verdict}</p>
          <p className="text-xs text-slate-500">Based on your skills &amp; preferences.</p>
        </div>
      </div>
      {result.matchedSkills.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Your matching skills</p>
          <ul className="mt-2 space-y-1.5">
            {result.matchedSkills.slice(0, 6).map((s) => (
              <li key={s} className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 size={14} className="text-green-600" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <summary className="ir35-focus flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg text-sm font-semibold text-slate-800 marker:content-none"><BarChart3 size={15} className="text-brand-700" />How this score is calculated</summary>
        <div className="mt-3 space-y-4 border-t border-slate-200 pt-4">
          {result.factors.map((factor) => (
            <div key={factor.id}>
              <div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-800">{factor.label}</span><span className="shrink-0 font-bold tabular-nums text-slate-600">{factor.points}/{factor.weight} points</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-brand-600" style={{ width: `${factor.fit}%` }} /></div>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">{factor.explanation}</p>
            </div>
          ))}
          {result.unmatchedSkills.length > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950"><strong>Profile skills not tagged in this listing:</strong> {result.unmatchedSkills.slice(0, 5).join(", ")}{result.unmatchedSkills.length > 5 ? "…" : ""}</p>}
          <p className="text-[11px] leading-5 text-slate-500">This is a deterministic comparison of structured listing data and your saved preferences. It is not an AI assessment, hiring prediction or guarantee.</p>
        </div>
      </details>
      {showTailorAction && (
        <Link
          href={`/jobs/${job.id}/resume`}
          className="ir35-focus mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <WandSparkles size={15} aria-hidden="true" /> Analyse &amp; tailor your Resume
        </Link>
      )}
    </div>
  );
}
