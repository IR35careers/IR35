"use client";

/**
 * Apply button for job detail pages.
 * Starts the application inside IR35Careers. The reviewed packet can be sent
 * only when the employer's submission connection is verified.
 */

import Link from "next/link";
import { Send } from "lucide-react";

export function ApplyButton({
  jobId,
  sourceDomain,
}: {
  jobId: string;
  sourceDomain: string;
}) {
  if (sourceDomain === "demo.ir35careers.local") {
    return (
      <div>
        <button
          type="button"
          disabled
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-slate-200 px-6 py-3 text-sm font-semibold text-slate-500"
        >
          Preview listing
        </button>
        <p className="mt-2 text-xs text-slate-600">
          Demo data never submits an application.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Link
        href={`/applications/new/${jobId}`}
        className="ir35-focus inline-flex min-h-12 items-center gap-2 rounded-xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
      >
        Apply with IR35Careers <Send size={14} aria-hidden="true" />
      </Link>
      <p className="mt-2 text-xs text-slate-600">
        Prepare, approve and submit without leaving your workspace when this employer connection is supported.
      </p>
    </div>
  );
}
