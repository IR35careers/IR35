"use client";

/**
 * WelcomeModal — shown once after a user first reaches the dashboard.
 * Explains, in three beats, how IR35Careers helps them land their next
 * contract. Dismissal is remembered per browser.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, ShieldCheck, Target, LayoutList, ArrowRight } from "lucide-react";

const KEY = "ir35careers:welcomed:v1";

const STEPS = [
  {
    icon: ShieldCheck,
    title: "Every role, IR35 status up front",
    body: "We label each contract Inside or Outside IR35, but only when the advert actually states it, and show the day rate before you click.",
  },
  {
    icon: Target,
    title: "Matches built from your profile",
    body: "Add your skills and CV and every contract gets a match score, so the right roles rise to the top instead of you scrolling.",
  },
  {
    icon: LayoutList,
    title: "Apply direct, track everything",
    body: "Applications go straight to the original listing. We never sit between you and the client. Save roles and track what you've applied for.",
  },
];

export function WelcomeModal({ name }: { name?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(KEY)) setOpen(true);
    } catch {
      /* storage unavailable — skip the modal rather than break the page */
    }
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={16} />
        </button>

        <div className="bg-gradient-to-br from-green-600 to-green-500 px-8 py-7 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/80">Welcome aboard</p>
          <h2 id="welcome-title" className="mt-1.5 text-2xl font-semibold tracking-tight">
            {name ? `You're in, ${name}.` : "You're in."}
          </h2>
          <p className="mt-1.5 text-sm text-white/85">
            Here&apos;s how IR35Careers helps you find your next contract.
          </p>
        </div>

        <div className="space-y-5 px-8 py-7">
          {STEPS.map((s, i) => (
            <div key={s.title} className="flex gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-green-50">
                <s.icon size={17} className="text-green-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {i + 1}. {s.title}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 border-t border-slate-100 px-8 py-5">
          <Link
            href="/onboarding"
            onClick={dismiss}
            className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
          >
            Set up my profile <ArrowRight size={15} />
          </Link>
          <button
            onClick={dismiss}
            className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400"
          >
            Explore first
          </button>
        </div>
      </div>
    </div>
  );
}
