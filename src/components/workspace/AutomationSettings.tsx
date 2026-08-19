"use client";

import { useState } from "react";
import { Bot, CheckCircle2, Eye, PauseCircle, PlayCircle, ShieldCheck, XCircle } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { evaluateAutomationJob } from "@/lib/workspace/engine";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { AutomationRules } from "@/lib/workspace/types";

export function AutomationSettings() {
  const workspace = useWorkspaceState();
  const [rules, setRules] = useState<AutomationRules>(workspace.automation);
  const [saved, setSaved] = useState(false);
  const latestRun = workspace.automationRuns[0] ?? null;

  const save = () => {
    const safeRules: AutomationRules = { ...rules, dryRunOnly: true, requireHumanApproval: true };
    updateWorkspace((current) => ({ ...current, automation: safeRules }));
    setRules(safeRules);
    setSaved(true);
  };

  const runPreview = () => {
    const matchingJobIds: string[] = [];
    const skipped: Array<{ jobId: string; reason: string }> = [];
    DEMO_JOBS.forEach((job, index) => {
      const score = Math.max(48, 88 - index * 7);
      const reason = evaluateAutomationJob(job, score, { ...rules, dryRunOnly: true, requireHumanApproval: true });
      if (reason) skipped.push({ jobId: job.id, reason });
      else matchingJobIds.push(job.id);
    });
    updateWorkspace((current) => ({
      ...current,
      automation: { ...rules, dryRunOnly: true, requireHumanApproval: true },
      automationRuns: [{ id: `run-${Date.now()}`, createdAt: new Date().toISOString(), matchingJobIds, skipped }, ...current.automationRuns].slice(0, 10),
    }));
  };

  const toggleArray = <T extends string>(values: T[], value: T): T[] => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return (
    <WorkspacePage eyebrow="Controlled automation" title="Set the rules once. Review every packet." description="IR35Careers can monitor matching contracts and prepare an application queue. The current implementation is permanently dry-run and requires human approval before any external handoff.">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Bot size={21} /></span><div><h2 className="font-semibold text-slate-950">Preparation monitor</h2><p className="text-sm text-slate-600">Find roles and prepare a review queue.</p></div></div><button type="button" role="switch" aria-checked={rules.enabled} onClick={() => setRules((current) => ({ ...current, enabled: !current.enabled }))} className={`ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${rules.enabled ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>{rules.enabled ? <PlayCircle size={17} /> : <PauseCircle size={17} />}{rules.enabled ? "Enabled" : "Paused"}</button></div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-800">Minimum match
                <input type="range" min="40" max="95" step="5" value={rules.minimumMatch} onChange={(event) => setRules((current) => ({ ...current, minimumMatch: Number(event.target.value) }))} className="mt-3 w-full accent-emerald-700" />
                <span className="mt-1 block text-sm font-bold text-brand-700">{rules.minimumMatch}% or higher</span>
              </label>
              <label className="text-sm font-semibold text-slate-800">Minimum day rate
                <input type="number" min="0" max="3000" step="25" value={rules.minimumDayRate} onChange={(event) => setRules((current) => ({ ...current, minimumDayRate: Number(event.target.value) }))} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" />
              </label>
              <label className="text-sm font-semibold text-slate-800">Daily preparation limit
                <input type="number" min="1" max="25" value={rules.dailyLimit} onChange={(event) => setRules((current) => ({ ...current, dailyLimit: Number(event.target.value) }))} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" />
              </label>
              <label className="text-sm font-semibold text-slate-800">Excluded companies
                <input value={rules.excludedCompanies.join(", ")} onChange={(event) => setRules((current) => ({ ...current, excludedCompanies: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} placeholder="Agency A, Company B" className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" />
              </label>
            </div>
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><h2 className="font-semibold">IR35 statuses</h2><div className="mt-4 space-y-2">{(["outside", "inside", "unknown"] as const).map((value) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm capitalize"><input type="checkbox" checked={rules.ir35.includes(value)} onChange={() => setRules((current) => ({ ...current, ir35: toggleArray(current.ir35, value) }))} className="h-5 w-5 accent-emerald-700" />{value === "unknown" ? "Status not stated" : `${value} IR35`}</label>)}</div></div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><h2 className="font-semibold">Working patterns</h2><div className="mt-4 space-y-2">{(["remote", "hybrid", "onsite", "unknown"] as const).map((value) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm capitalize"><input type="checkbox" checked={rules.workplaces.includes(value)} onChange={() => setRules((current) => ({ ...current, workplaces: toggleArray(current.workplaces, value) }))} className="h-5 w-5 accent-emerald-700" />{value}</label>)}</div></div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><h2 className="font-semibold">Non-negotiable controls</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><ShieldCheck className="text-emerald-700" /><p className="mt-3 text-sm font-semibold text-emerald-950">Dry-run only</p><p className="mt-1 text-xs leading-5 text-emerald-900">No ATS form is submitted and no email is sent.</p></div><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><Eye className="text-emerald-700" /><p className="mt-3 text-sm font-semibold text-emerald-950">Human approval required</p><p className="mt-1 text-xs leading-5 text-emerald-900">The exact CV, letter and answers remain reviewable.</p></div></div></section>

          <div className="flex flex-col gap-3 sm:flex-row"><button type="button" onClick={save} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700"><CheckCircle2 size={17} /> Save rules</button><button type="button" onClick={runPreview} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 hover:border-brand-300"><Eye size={17} /> Run preview now</button>{saved && <p className="self-center text-sm font-semibold text-emerald-700" role="status">Rules saved locally.</p>}</div>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-max">
          <section className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white shadow-card"><p className="text-xs font-bold uppercase tracking-wide text-emerald-300">Latest preview</p>{latestRun ? <><p className="mt-3 text-4xl font-bold tabular-nums">{latestRun.matchingJobIds.length}</p><p className="mt-1 text-sm text-slate-300">contracts entered the review queue</p><p className="mt-4 text-xs text-slate-400">Run {new Date(latestRun.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p></> : <p className="mt-3 text-sm leading-6 text-slate-300">Run the preview to see which labelled demo contracts meet your rules.</p>}</section>
          {latestRun && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card"><h2 className="font-semibold">Decision log</h2><ul className="mt-4 space-y-3">{DEMO_JOBS.map((job) => { const skip = latestRun.skipped.find((item) => item.jobId === job.id); return <li key={job.id} className="flex gap-3 border-b border-slate-100 pb-3 last:border-0"><span className="mt-0.5">{skip ? <XCircle className="text-slate-400" size={17} /> : <CheckCircle2 className="text-emerald-600" size={17} />}</span><div><p className="text-sm font-semibold text-slate-800">{job.title}</p><p className="mt-1 text-xs text-slate-500">{skip?.reason ?? "Prepared for human review"}</p></div></li>; })}</ul></section>}
        </aside>
      </div>
    </WorkspacePage>
  );
}

