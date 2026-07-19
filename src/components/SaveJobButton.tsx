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
      className={`inline-flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
        status === "applied"
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
          : status === "saved"
            ? "border-sky-400/40 bg-sky-400/10 text-sky-300 hover:bg-sky-400/20"
            : "border-white/15 bg-white/[0.06] text-white/80 hover:border-white/30 hover:text-white"
      }`}
    >
      <Icon size={15} /> {label}
    </button>
  );
}
