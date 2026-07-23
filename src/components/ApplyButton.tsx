"use client";

/**
 * Apply button for job detail pages.
 * Signed in  → direct link to the original listing.
 * Signed out → "Sign in to apply", returning here after authentication.
 */

import Link from "next/link";
import { ExternalLink, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export function ApplyButton({
  applyUrl,
  sourceDomain,
  jobId,
}: {
  applyUrl: string;
  sourceDomain: string;
  jobId: string;
}) {
  const { user, loading } = useAuth();
  const domainLabel = sourceDomain.replace("www.", "");

  if (!loading && !user) {
    return (
      <div>
        <Link
          href={`/account?next=${encodeURIComponent(`/jobs/${jobId}`)}`}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-green-400 to-green-400 px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          <Lock size={14} /> Sign in to apply
        </Link>
        <p className="mt-2 text-xs text-slate-400">
          Free account. Takes under a minute, then you apply on the original listing.
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
        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      >
        Apply on {domainLabel} <ExternalLink size={14} />
      </a>
      <p className="mt-2 text-xs text-slate-400">
        Applications open on the original listing. IR35Careers never sits between you and the
        client.
      </p>
    </div>
  );
}
