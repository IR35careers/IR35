"use client";

/**
 * Apply button for job detail pages.
 * Direct link to the original listing for every visitor. Personal actions
 * such as saving and match scoring remain authenticated.
 */

import { ExternalLink } from "lucide-react";

export function ApplyButton({
  applyUrl,
  sourceDomain,
}: {
  applyUrl: string;
  sourceDomain: string;
}) {
  const domainLabel = sourceDomain.replace("www.", "");

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
      <a
        href={applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="ir35-focus inline-flex min-h-12 items-center gap-2 rounded-xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
      >
        Apply on {domainLabel} <ExternalLink size={14} />
      </a>
      <p className="mt-2 text-xs text-slate-600">
        Opens the original listing. Review its details before submitting.
      </p>
    </div>
  );
}
