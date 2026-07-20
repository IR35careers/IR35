"use client";

/**
 * SaveJobButton — save a job, mark it applied, or remove it.
 * Renders nothing for signed-out visitors (they see the sign-in apply CTA).
 */

import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

type Status = "none" | "saved" | "applied";

export function SaveJobButton({ jobId }: { jobId: string }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>("none");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("saved_jobs")
      .select("status")
      .eq("user_id", user.id)
      .eq("job_id", jobId)
      .maybeSingle()
      .then(({ data }: { data: { status: string } | null }) => {
        if (data) setStatus(data.status as Status);
      });
  }, [user, jobId]);

  if (!user) return null;

  const cycle = async () => {
    setBusy(true);
    try {
      if (status === "none") {
        await supabase.from("saved_jobs").upsert({ user_id: user.id, job_id: jobId, status: "saved" });
        setStatus("saved");
      } else if (status === "saved") {
        await supabase.from("saved_jobs").upsert({ user_id: user.id, job_id: jobId, status: "applied" });
        setStatus("applied");
      } else {
        await supabase.from("saved_jobs").delete().eq("user_id", user.id).eq("job_id", jobId);
        setStatus("none");
      }
    } finally {
      setBusy(false);
    }
  };

  const label =
    status === "none" ? "Save job" : status === "saved" ? "Mark as applied" : "Applied ✓ (remove)";
  const Icon = status === "none" ? Bookmark : status === "saved" ? BookmarkCheck : CheckCircle2;

  return (
    <button
      onClick={cycle}
      disabled={busy}
      className={`inline-flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
        status === "applied"
          ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
          : status === "saved"
            ? "border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100"
            : "border-slate-300 bg-slate-100 text-slate-800 hover:border-slate-400 hover:text-slate-900"
      }`}
    >
      <Icon size={15} /> {label}
    </button>
  );
}
