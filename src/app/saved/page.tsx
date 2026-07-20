"use client";

/**
 * /saved — the user's saved & applied contracts, with a status filter.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Bookmark, MapPin } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { formatRate, formatPosted, type JobListing } from "@/lib/job-types";
import { AppNav } from "@/components/AppNav";

type Row = { status: string; job: JobListing };

export default function SavedJobsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [filter, setFilter] = useState<"all" | "saved" | "applied">("all");

  useEffect(() => {
    if (!loading && !user) router.replace("/account?next=/saved");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("saved_jobs")
      .select("status, jobs(id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }: { data: Array<{ status: string; jobs: unknown }> | null }) => {
        setRows((data ?? []).filter((r) => r.jobs).map((r) => ({ status: r.status, job: r.jobs as unknown as JobListing })));
        setBusy(false);
      });
  }, [user]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const counts = { all: rows.length, saved: rows.filter((r) => r.status === "saved").length, applied: rows.filter((r) => r.status === "applied").length };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav />
      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
        <div className="flex items-center gap-2">
          <Bookmark className="text-green-600" size={22} />
          <h1 className="text-2xl font-semibold tracking-tight">Saved &amp; applied</h1>
        </div>

        <div className="mt-5 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(["all", "saved", "applied"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === f ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {f} ({counts[f]})
            </button>
          ))}
        </div>

        {busy ? (
          <div className="mt-16 flex justify-center text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
        ) : shown.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-slate-700">Nothing here yet.</p>
            <p className="mt-1 text-sm text-slate-500">Open any contract and hit <span className="font-medium text-slate-700">Save job</span> to keep it here.</p>
            <Link href="/jobs" className="mt-4 inline-flex rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700">Browse contracts</Link>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {shown.map(({ status, job }) => (
              <li key={job.id}>
                <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-green-300">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{job.title}</p>
                    <p className="flex items-center gap-1.5 truncate text-sm text-slate-500">
                      {job.company_name} <span aria-hidden>·</span> <MapPin size={12} /> {job.location} <span aria-hidden>·</span> {formatPosted(job)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden text-sm font-semibold tabular-nums sm:block">{formatRate(job)}</span>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${status === "applied" ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                      {status === "applied" ? "Applied" : "Saved"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
