"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { StatePanel } from "@/components/ui/state-panel";

export default function JobDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <PublicHeader />
      <main className="ir35-container py-16 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <StatePanel kind="error" title="This contract could not be loaded" body="The listing may be refreshing or temporarily unavailable. Retry once, or return to search without losing your filters." action={<div className="flex flex-wrap justify-center gap-2"><button type="button" onClick={reset} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"><RefreshCw size={15} /> Retry details</button><Link href="/jobs" className="ir35-focus inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-brand-300">Back to contracts</Link></div>} />
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
