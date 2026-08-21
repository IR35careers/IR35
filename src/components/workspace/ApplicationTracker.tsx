"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BriefcaseBusiness, CalendarClock, ChevronRight, RotateCcw } from "lucide-react";
import { WorkspacePage, StatusPill } from "@/components/workspace/WorkspacePage";
import { getSupabase } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { resetWorkspace, updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { ApplicationRecord, ApplicationStatus } from "@/lib/workspace/types";

const PIPELINE: Array<{ id: ApplicationStatus; label: string }> = [
  { id: "needs_review", label: "Needs you" },
  { id: "ready", label: "Ready" },
  { id: "applied", label: "Applied" },
  { id: "replied", label: "Replied" },
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
];

const CLOSED_STATUSES = new Set<ApplicationStatus>(["offer", "rejected", "withdrawn", "failed", "skipped"]);

export function ApplicationTracker() {
  const workspace = useWorkspaceState();
  const [filter, setFilter] = useState<"active" | "all" | "closed">("active");
  const applications = useMemo(
    () => workspace.applications.filter((application) => filter === "all" || (filter === "closed" ? CLOSED_STATUSES.has(application.status) : !CLOSED_STATUSES.has(application.status))),
    [filter, workspace.applications]
  );

  const refreshIds = useMemo(() => workspace.applications.filter((item) => item.status === "ready" || item.status === "needs_review").slice(0, 10).map((item) => item.id), [workspace.applications]);

  useEffect(() => {
    if (!isSupabaseConfigured() || refreshIds.length === 0) return;
    let active = true;
    const refresh = async () => {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token || !active) return;
      for (const applicationId of refreshIds) {
        const response = await fetch(`/api/applications/submission-status?applicationId=${encodeURIComponent(applicationId)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok && response.status !== 202) continue;
        const payload = (await response.json()) as { state?: "submitted" | "processing" | "needs_user"; receipt?: ApplicationRecord["receipt"]; questions?: ApplicationRecord["questions"] };
        if (!active || (payload.state !== "submitted" && payload.state !== "needs_user")) continue;
        updateWorkspace((current) => ({
          ...current,
          applications: current.applications.map((application) => application.id !== applicationId ? application : {
            ...application,
            status: payload.state === "submitted" ? "applied" : "needs_review",
            receipt: payload.receipt ?? application.receipt,
            mode: payload.state === "submitted" ? "external_handoff" : application.mode,
            questions: payload.questions ?? application.questions,
            submissionApproved: payload.state === "needs_user" ? false : application.submissionApproved,
            updatedAt: new Date().toISOString(),
          }),
        }));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refreshIds]);

  return (
    <WorkspacePage
      eyebrow="Applications"
      title="Your contract pipeline"
      description="Track every prepared application, recruiter response and interview without relying on a spreadsheet. Status changes are explicit and work without drag-and-drop."
      actions={<Link href="/jobs" className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">Browse contracts <ArrowRight size={15} /></Link>}
    >
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Application pipeline summary">
        {PIPELINE.map((stage) => {
          const count = workspace.applications.filter((application) => application.status === stage.id).length;
          return <div key={stage.id} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-2xl font-bold tabular-nums text-slate-950">{count}</p><p className="mt-1 text-xs font-semibold text-slate-600">{stage.label}</p></div>;
        })}
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {(["active", "all", "closed"] as const).map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`ir35-focus min-h-10 rounded-lg px-4 text-sm font-semibold capitalize ${filter === item ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{item}</button>)}
        </div>
        <button type="button" onClick={resetWorkspace} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-600 hover:border-slate-400"><RotateCcw size={15} /> Reset preview</button>
      </div>

      {applications.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center"><BriefcaseBusiness className="mx-auto text-slate-400" /><h2 className="mt-4 font-semibold">No applications in this view</h2><p className="mt-1 text-sm text-slate-600">Prepare a role from any contract detail page.</p></div>
      ) : (
        <div className="mt-6 grid gap-4">
          {applications.map((application) => (
            <article key={application.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px_220px] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><StatusPill status={application.status} /><span className="text-xs font-semibold text-slate-500">{application.matchScore}% CV match</span></div>
                  <h2 className="mt-2 truncate text-lg font-semibold text-slate-950">{application.job.title}</h2>
                  <p className="truncate text-sm text-slate-600">{application.job.company_name} · {application.job.location}</p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><CalendarClock size={13} /> Updated {new Date(application.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Live status</p><div className="mt-2"><StatusPill status={application.status} /></div><p className="mt-2 text-xs leading-5 text-slate-500">Updated automatically from the application system and recruiter inbox.</p></div>
                <div className="flex flex-col gap-2">
                  <Link href={`/applications/new/${application.job.id}`} className="ir35-focus inline-flex min-h-11 items-center justify-between rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-brand-300">Review packet <ChevronRight size={15} /></Link>
                  <Link href={`/jobs/${application.job.id}`} className="ir35-focus inline-flex min-h-11 items-center justify-between rounded-xl px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50">Open role <ChevronRight size={15} /></Link>
                </div>
              </div>
              <ol className="mt-5 grid gap-2 border-t border-slate-100 pt-5 md:grid-cols-3">
                {application.events.slice(-3).map((event) => <li key={event.id} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-800">{event.label}</p><p className="mt-1 text-[11px] text-slate-500">{new Date(event.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p></li>)}
              </ol>
            </article>
          ))}
        </div>
      )}
    </WorkspacePage>
  );
}
