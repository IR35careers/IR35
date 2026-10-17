"use client";

import Link from "next/link";
import { BarChart3, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ANALYTICS_CONSENT_EVENT, ANALYTICS_CONSENT_KEY } from "@/components/GoogleAnalytics";

export function CookieNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (window.location.hostname === "admin.ir35careers.com") {
      setOpen(false);
      return;
    }
    try {
      setOpen(!window.localStorage.getItem(ANALYTICS_CONSENT_KEY));
    } catch {
      setOpen(true);
    }
    const showPreferences = () => setOpen(true);
    window.addEventListener("ir35-open-cookie-settings", showPreferences);
    return () => window.removeEventListener("ir35-open-cookie-settings", showPreferences);
  }, []);

  const choose = (value: "granted" | "denied") => {
    try {
      window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
    } catch {
      // The choice still applies to the current page when storage is blocked.
    }
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
    setOpen(false);
  };

  if (!open) return null;

  return (
    <section
      aria-label="Analytics and cookie choices"
      className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-slate-200 bg-white p-4 shadow-floating sm:bottom-5 sm:left-5 sm:right-auto sm:max-w-md sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-800">
          <BarChart3 size={19} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-950">Help us improve IR35Careers</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">
            Allow anonymous analytics to help us improve the product. We never send your Resume, application answers or account identity.
          </p>
          <Link href="/cookies" className="ir35-focus mt-1 inline-flex rounded text-xs font-semibold text-brand-700 hover:underline sm:text-sm">
            Read the cookie policy
          </Link>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => choose("denied")} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"><ShieldCheck size={16} aria-hidden="true" /> Essential only</button>
        <button type="button" onClick={() => choose("granted")} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-brand-700"><BarChart3 size={16} aria-hidden="true" /> Allow analytics</button>
      </div>
      <button
        type="button"
        onClick={() => choose("denied")}
        aria-label="Use essential storage only"
        className="ir35-focus absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </section>
  );
}
