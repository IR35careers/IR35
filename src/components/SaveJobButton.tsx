"use client";

/**
 * SaveJobButton keeps a role in the contractor's saved list or removes it.
 * Application status belongs to the verified submission workflow and is never
 * changed here. Signed-in updates are optimistic and roll back on failure.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

type Status = "none" | "saved";

export function SaveJobButton({ jobId }: { jobId: string }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("saved_jobs")
      .select("status")
      .eq("user_id", user.id)
      .eq("job_id", jobId)
      .maybeSingle()
      .then(({ data }: { data: { status: string } | null }) => {
        if (data) setStatus("saved");
      });
  }, [user, jobId]);

  if (!user) {
    return (
      <Link
        href={`/account?next=${encodeURIComponent(`/jobs/${jobId}`)}`}
        prefetch={false}
        className="ir35-focus inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition-colors hover:border-brand-300 hover:bg-brand-50"
      >
        <Bookmark size={15} aria-hidden="true" /> Sign in to save
      </Link>
    );
  }

  const cycle = async () => {
    const previous = status;
    const next: Status = status === "none" ? "saved" : "none";
    setError(null);
    setStatus(next);
    setBusy(true);
    try {
      if (next === "saved") {
        const { error: saveError } = await supabase
          .from("saved_jobs")
          .upsert({ user_id: user.id, job_id: jobId, status: next });
        if (saveError) throw saveError;
      } else {
        const { error: deleteError } = await supabase
          .from("saved_jobs")
          .delete()
          .eq("user_id", user.id)
          .eq("job_id", jobId);
        if (deleteError) throw deleteError;
      }
    } catch {
      setStatus(previous);
      setError("We couldn’t update this job. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const label = status === "none" ? "Save job" : "Saved";
  const Icon = status === "none" ? Bookmark : BookmarkCheck;

  return (
    <div>
      <button
        onClick={cycle}
        disabled={busy}
        aria-busy={busy}
        className={`ir35-focus inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-medium transition-colors disabled:opacity-60 ${
          status === "saved"
            ? "border-brand-300 bg-brand-50 text-brand-800 hover:bg-brand-100"
            : "border-slate-300 bg-white text-slate-800 hover:border-brand-300 hover:bg-brand-50"
        }`}
      >
        <Icon size={15} aria-hidden="true" /> {label}
      </button>
      {error && <p className="mt-2 max-w-52 text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}
