"use client";

/**
 * JobMatchPanel — shows the signed-in user's real (rule-based) match score
 * for this job, with the matched skills. Hidden for signed-out visitors, who
 * see a prompt to sign in. Honest: this is the same skills/rate/IR35 scoring
 * used across the app — labelled "match", not "AI".
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getProfile, scoreJob } from "@/lib/profile";
import type { JobListing } from "@/lib/job-types";

export function JobMatchPanel({ job }: { job: JobListing }) {
  const { user, loading } = useAuth();
  const [result, setResult] = useState<{ score: number; matched: string[] } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user) {
      setReady(true);
      return;
    }
    getProfile(user.id).then((p) => {
      if (p && p.skills.length > 0) {
        const scored = scoreJob(job, p);
        if (scored) setResult({ score: scored.score, matched: scored.matchedSkills });
      }
      setReady(true);
    });
  }, [user, job]);

  if (loading || !ready) return null;

  if (!user) {
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
          className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
        >
          Sign in to see match
        </Link>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Sparkles size={15} className="text-green-600" /> Your match score
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Add skills to your profile to see how this contract matches you.
        </p>
        <Link href="/onboarding" className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400">
          Complete profile
        </Link>
      </div>
    );
  }

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
      {result.matched.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your matching skills</p>
          <ul className="mt-2 space-y-1.5">
            {result.matched.slice(0, 6).map((s) => (
              <li key={s} className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 size={14} className="text-green-600" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
