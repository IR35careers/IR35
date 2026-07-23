"use client";

/**
 * BetaDeniedModal — shown when a signed-in account isn't on the private-beta
 * list. Names the exact account that was refused so the person (or the owner
 * testing with several Google accounts) can tell immediately what happened.
 */

import Link from "next/link";
import { Lock, X, ArrowRight } from "lucide-react";

export function BetaDeniedModal({
  email,
  onJoin,
  onClose,
}: {
  email?: string | null;
  onJoin: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="beta-denied-title"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={16} />
        </button>

        <div className="px-8 pb-7 pt-9 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
            <Lock size={20} className="text-amber-600" />
          </div>

          <h2 id="beta-denied-title" className="mt-4 text-xl font-semibold tracking-tight text-slate-900">
            IR35Careers is in private beta
          </h2>

          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {email ? (
              <>
                <span className="font-medium text-slate-900">{email}</span> isn&apos;t on the beta
                list yet. Join the waitlist and we&apos;ll email you the moment access opens.
              </>
            ) : (
              <>
                This account isn&apos;t on the beta list yet. Join the waitlist and we&apos;ll email
                you the moment access opens.
              </>
            )}
          </p>

          <div className="mt-6 space-y-2.5">
            <button
              onClick={onJoin}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
            >
              Join the waitlist <ArrowRight size={15} />
            </button>
            <button
              onClick={onClose}
              className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400"
            >
              Try a different account
            </button>
          </div>

          <p className="mt-5 text-xs text-slate-400">
            Browsing stays open: you can still{" "}
            <Link href="/contracts/outside-ir35-contracts" className="underline underline-offset-2 hover:text-slate-600">
              preview live contracts
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
