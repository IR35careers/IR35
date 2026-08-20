"use client";

import Link from "next/link";
import { ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "ir35_privacy_notice_ack_v1";

/**
 * The production site currently uses only storage required for authentication,
 * security and the user's own workspace. This is a transparency notice rather
 * than an opt-in banner: no analytics or advertising storage is activated here.
 */
export function CookieNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(STORAGE_KEY) !== "acknowledged");
    } catch {
      setOpen(true);
    }
  }, []);

  const acknowledge = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "acknowledged");
    } catch {
      // The notice can still be dismissed for the current page when storage is blocked.
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <section
      aria-label="Privacy and essential storage notice"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-2xl border border-slate-300 bg-white p-4 shadow-floating sm:bottom-5 sm:flex sm:items-center sm:gap-4 sm:p-5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-800">
        <ShieldCheck size={19} aria-hidden="true" />
      </span>
      <div className="mt-3 min-w-0 flex-1 sm:mt-0">
        <h2 className="text-sm font-bold text-slate-950">Essential storage only</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">
          We use essential browser storage for secure sign-in, account preferences and the features you request. We do not currently use advertising cookies or non-essential analytics.
        </p>
        <Link href="/cookies" className="ir35-focus mt-1 inline-flex rounded text-xs font-semibold text-brand-700 hover:underline sm:text-sm">
          Read the cookie policy
        </Link>
      </div>
      <button
        type="button"
        onClick={acknowledge}
        className="ir35-focus mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-brand-700 sm:mt-0 sm:w-auto"
      >
        Understood
      </button>
      <button
        type="button"
        onClick={acknowledge}
        aria-label="Dismiss privacy notice"
        className="ir35-focus absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 sm:hidden"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </section>
  );
}
