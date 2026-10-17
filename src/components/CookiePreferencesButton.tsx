"use client";

import { Settings2 } from "lucide-react";

export function CookiePreferencesButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("ir35-open-cookie-settings"))}
      className="ir35-focus mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-brand-300 hover:text-brand-800"
    >
      <Settings2 size={16} aria-hidden="true" /> Change analytics choice
    </button>
  );
}
