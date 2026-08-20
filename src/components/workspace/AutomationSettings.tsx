"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Eye, Loader2, PauseCircle, PlayCircle, PlugZap, ShieldCheck, XCircle } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { evaluateAutomationJob } from "@/lib/workspace/engine";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { AutomationRules } from "@/lib/workspace/types";
import { useAuth } from "@/lib/auth-context";
import { getSupabase } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { getProfile, PREVIEW_PROFILE, scoreJob } from "@/lib/profile";
import type { JobListing } from "@/lib/job-types";

export function AutomationSettings() {
  const workspace = useWorkspaceState();
  const { user } = useAuth();
  const [rules, setRules] = useState<AutomationRules>(workspace.automation);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [submissionState, setSubmissionState] = useState<"loading" | "connected" | "gated">(isSupabaseConfigured() ? "loading" : "gated");
  const latestRun = workspace.automationRuns[0] ?? null;

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    void getSupabase().auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!token) throw new Error("No session");
      const response = await fetch("/api/integrations/status", { headers: { authorization: `Bearer ${token}` } });
      const payload = response.ok ? (await response.json()) as { integrations?: Array<{ id: string; state: string }> } : null;
      if (active) setSubmissionState(payload?.integrations?.find((item) => item.id === "ats_submission")?.state === "connected" ? "connected" : "gated");
    }).catch(() => { if (active) setSubmissionState("gated"); });
    return () => { active = false; };
  }, []);

  const save = () => {
    const safeRules: AutomationRules = { ...rules, dryRunOnly: true, requireHumanApproval: true };
    updateWorkspace((current) => ({ ...current, automation: safeRules }));
    setRules(safeRules);
    setSaved(true);
  };

  const runPreview = async () => {
    setRunning(true);
    setRunError(null);
    const matchingJobIds: string[] = [];
    const skipped: Array<{ jobId: string; reason: string }> = [];
    try {
      let jobs: JobListing[] = DEMO_JOBS;
      let profile = PREVIEW_PROFILE;
      if (isSupabaseConfigured()) {
        const params = new URLSearchParams({ per_page: "50", sort: "recent" });
        if (rules.minimumDayRate > 0) params.set("min_rate", String(rules.minimumDayRate));
        const response = await fetch(`/api/jobs/search?${params.toString()}`);
        const payload = (await response.json()) as { jobs?: JobListing[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Live contracts could not be loaded.");
        jobs = payload.jobs ?? [];
        if (user) profile = (await getProfile(user.id)) ?? PREVIEW_PROFILE;
      }
      jobs.forEach((job) => {
        const score = scoreJob(job, profile)?.score ?? 0;
        const reason = evaluateAutomationJob(job, score, { ...rules, dryRunOnly: true, requireHumanApproval: true });
        if (reason) skipped.push({ jobId: job.id, reason });
        else matchingJobIds.push(job.id);
      });
      updateWorkspace((current) => ({
        ...current,
        automation: { ...rules, dryRunOnly: true, requireHumanApproval: true },
        automationRuns: [{ id: globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`, createdAt: new Date().toISOString(), matchingJobIds, skipped }, ...current.automationRuns].slice(0, 10),
      }));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The live preview could not run.");
    } finally {
      setRunning(false);
    }
  };

  const toggleArray = <T extends string>(values: T[], value: T): T[] => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return (
    <WorkspacePage eyebrow="Controlled automation" title="Set the rules once. Review every packet." description="Monitor live contracts, build a focused review queue and keep final submission under explicit approval. Discovery automation and external submission remain separate controls.">
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

          <div className="flex flex-col gap-3 sm:flex-row"><button type="button" onClick={save} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700"><CheckCircle2 size={17} /> Save rules</button><button type="button" onClick={() => void runPreview()} disabled={running} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 hover:border-brand-300 disabled:opacity-50">{running ? <Loader2 className="animate-spin" size={17} /> : <Eye size={17} />} {running ? "Checking live contracts…" : "Run live preview"}</button>{saved && <p className="self-center text-sm font-semibold text-emerald-700" role="status">Rules saved.</p>}</div>
          {runError && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert">{runError}</p>}
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-max">
          <section className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white shadow-card"><p className="text-xs font-bold uppercase tracking-wide text-emerald-300">Latest preview</p>{latestRun ? <><p className="mt-3 text-4xl font-bold tabular-nums">{latestRun.matchingJobIds.length}</p><p className="mt-1 text-sm text-slate-300">contracts entered the review queue</p><p className="mt-4 text-xs text-slate-400">Run {new Date(latestRun.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p></> : <p className="mt-3 text-sm leading-6 text-slate-300">Run a live preview to check current contracts against your profile and rules.</p>}</section>
          <section className={`rounded-3xl border p-5 shadow-card ${submissionState === "connected" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><PlugZap size={20} className={submissionState === "connected" ? "text-emerald-700" : "text-amber-800"} /><p className={`mt-3 text-xs font-bold uppercase tracking-wide ${submissionState === "connected" ? "text-emerald-700" : "text-amber-800"}`}>Submission connection</p><h2 className={`mt-2 font-semibold ${submissionState === "connected" ? "text-emerald-950" : "text-amber-950"}`}>{submissionState === "loading" ? "Checking provider…" : submissionState === "connected" ? "Authorised provider connected" : "Provider required"}</h2><p className={`mt-2 text-sm leading-6 ${submissionState === "connected" ? "text-emerald-900" : "text-amber-900"}`}>{submissionState === "connected" ? "Approved packets can be submitted from their final review screen, with an idempotent receipt." : "Rules can monitor and prepare now. Automatic external submission stays unavailable until an authorised gateway is connected."}</p></section>
          {latestRun && !isSupabaseConfigured() && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card"><h2 className="font-semibold">Decision log</h2><ul className="mt-4 space-y-3">{DEMO_JOBS.map((job) => { const skip = latestRun.skipped.find((item) => item.jobId === job.id); return <li key={job.id} className="flex gap-3 border-b border-slate-100 pb-3 last:border-0"><span className="mt-0.5">{skip ? <XCircle className="text-slate-400" size={17} /> : <CheckCircle2 className="text-emerald-600" size={17} />}</span><div><p className="text-sm font-semibold text-slate-800">{job.title}</p><p className="mt-1 text-xs text-slate-500">{skip?.reason ?? "Prepared for human review"}</p></div></li>; })}</ul></section>}
        </aside>
      </div>
    </WorkspacePage>
  );
}
