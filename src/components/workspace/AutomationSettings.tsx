"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Eye, Loader2, LockKeyhole, PauseCircle, PlayCircle, Plus, Send, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { AUTO_APPLY_CONSENT_VERSION, DEFAULT_AUTO_APPLY_LANES, hasCurrentAutoApplyConsent } from "@/lib/automation/auto-apply";
import { clampDailyApplicationLimit, FREE_DAILY_APPLICATION_LIMIT, hasActivePremiumPlan, maximumDailyApplicationLimit } from "@/lib/automation/daily-limit";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { fetchWithFreshSession } from "@/lib/authenticated-fetch";
import { evaluateAutomationJob } from "@/lib/workspace/engine";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { ApplicationPreferences, ApplicationRecord, AutoApplyLane, AutomationRules } from "@/lib/workspace/types";
import { useAuth } from "@/lib/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { getProfile, PREVIEW_PROFILE, scoreJob } from "@/lib/profile";
import type { JobListing } from "@/lib/job-types";

const DEFAULT_PREFERENCES: ApplicationPreferences = {
  resumeOptimisation: "honest",
  autoApproveSafeEdits: true,
  reviewBeforeSubmit: true,
  generateCoverLetter: true,
  usePrivateApplicationEmail: true,
};

function newLane(): AutoApplyLane {
  return { id: crypto.randomUUID(), role: "", keywords: [], location: "United Kingdom", enabled: true };
}

export function AutomationSettings() {
  const workspace = useWorkspaceState();
  const { user } = useAuth();
  const storedPreferences = workspace.profile.applicationPreferences ?? DEFAULT_PREFERENCES;
  const premiumActive = hasActivePremiumPlan(workspace.entitlement);
  const maximumDailyLimit = maximumDailyApplicationLimit(workspace.entitlement);
  const [rules, setRules] = useState<AutomationRules>(() => ({
    ...workspace.automation,
    dailyLimit: clampDailyApplicationLimit(workspace.automation.dailyLimit, workspace.entitlement),
  }));
  const [autoApplyEnabled, setAutoApplyEnabled] = useState(Boolean(storedPreferences.autoApplyEnabled));
  const [consentAccepted, setConsentAccepted] = useState(hasCurrentAutoApplyConsent({
    enabled: storedPreferences.autoApplyEnabled,
    consentAt: storedPreferences.autoApplyConsentAt,
    consentVersion: storedPreferences.autoApplyConsentVersion,
  }));
  const [lanes, setLanes] = useState<AutoApplyLane[]>(storedPreferences.autoApplyLanes?.length ? storedPreferences.autoApplyLanes : DEFAULT_AUTO_APPLY_LANES);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [applyElapsedSeconds, setApplyElapsedSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showPremiumNotice, setShowPremiumNotice] = useState(false);
  const latestRun = workspace.automationRuns[0] ?? null;

  useEffect(() => {
    if (busy !== "apply") {
      setApplyElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setApplyElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    setRules((current) => ({
      ...current,
      dailyLimit: clampDailyApplicationLimit(current.dailyLimit, workspace.entitlement),
    }));
  }, [workspace.entitlement]);

  const preferencesForSave = (): ApplicationPreferences => ({
    ...storedPreferences,
    autoApplyEnabled: autoApplyEnabled && consentAccepted,
    autoApplyConsentAt: autoApplyEnabled && consentAccepted
      ? storedPreferences.autoApplyConsentAt || new Date().toISOString()
      : undefined,
    autoApplyConsentVersion: autoApplyEnabled && consentAccepted ? AUTO_APPLY_CONSENT_VERSION : undefined,
    autoApplyLanes: lanes,
  });

  const persistSettings = (): ApplicationPreferences | null => {
    if (autoApplyEnabled && !consentAccepted) {
      setRunError("Confirm the Auto Apply instruction before enabling it.");
      return null;
    }
    const preferences = preferencesForSave();
    const safeRules: AutomationRules = {
      ...rules,
      enabled: autoApplyEnabled,
      dryRunOnly: true,
      requireHumanApproval: true,
      dailyLimit: clampDailyApplicationLimit(rules.dailyLimit, workspace.entitlement),
    };
    updateWorkspace((current) => ({
      ...current,
      automation: safeRules,
      profile: { ...current.profile, applicationPreferences: preferences },
    }));
    setRules(safeRules);
    setSaved(true);
    setRunError(null);
    setNotice("Auto Apply settings saved.");
    return preferences;
  };

  const runPreview = async () => {
    setBusy("preview");
    setRunError(null);
    setNotice(null);
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
        const reason = evaluateAutomationJob(job, score, { ...rules, enabled: true, dryRunOnly: true, requireHumanApproval: true });
        if (reason) skipped.push({ jobId: job.id, reason });
        else matchingJobIds.push(job.id);
      });
      updateWorkspace((current) => ({
        ...current,
        automationRuns: [{ id: globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`, createdAt: new Date().toISOString(), matchingJobIds, skipped }, ...current.automationRuns].slice(0, 10),
      }));
      setNotice(`${matchingJobIds.length} matching contract${matchingJobIds.length === 1 ? "" : "s"} found.`);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The live preview could not run.");
    } finally {
      setBusy(null);
    }
  };

  const runAutoApply = async () => {
    const preferences = persistSettings();
    if (!preferences) return;
    if (!user) {
      setRunError("Sign in before starting Auto Apply.");
      return;
    }
    setBusy("apply");
    setRunError(null);
    setNotice("Selecting the next matching contract and completing its application.");
    try {
      const response = await fetchWithFreshSession("/api/automation/apply-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: {
            ...rules,
            enabled: true,
            dailyLimit: clampDailyApplicationLimit(rules.dailyLimit, workspace.entitlement),
          },
          preferences,
        }),
        signal: AbortSignal.timeout(145_000),
      });
      const payload = await response.json().catch(() => ({ error: "The application service returned an unreadable response." })) as { state?: string; application?: ApplicationRecord; message?: string; error?: string; action?: string };
      if (payload.application) {
        updateWorkspace((current) => ({
          ...current,
          applications: [payload.application as ApplicationRecord, ...current.applications.filter((item) => item.id !== payload.application?.id)],
        }));
      }
      if (!response.ok && response.status !== 202) throw new Error(payload.error ?? payload.message ?? "Auto Apply could not complete the contract.");
      if (payload.state === "needs_user") setNotice(payload.message || "This application needs an answer from you. Open Applications to continue.");
      else if (payload.application?.status === "applied") setNotice(`Applied successfully to ${payload.application.job.title} at ${payload.application.job.company_name}.`);
      else setNotice(payload.message || "The application has started. Its employer status will update in Applications.");
    } catch (error) {
      setRunError(error instanceof DOMException && error.name === "TimeoutError"
        ? "The employer did not confirm within the safe application window. Check Applications before trying again."
        : error instanceof Error ? error.message : "Auto Apply could not complete the contract.");
    } finally {
      setBusy(null);
    }
  };

  const updateLane = (id: string, patch: Partial<AutoApplyLane>) => setLanes((current) => current.map((lane) => lane.id === id ? { ...lane, ...patch } : lane));
  const toggleArray = <T extends string>(values: T[], value: T): T[] => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return (
    <WorkspacePage eyebrow="Auto Apply" title="Set your preferences once" description="Choose the contracts you want. IR35Careers prepares each application from your saved profile and keeps every update in your tracker.">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Bot size={21} /></span><div><h2 className="font-semibold text-slate-950">Auto Apply</h2><p className="text-sm text-slate-600">Pause or resume your saved searches at any time.</p></div></div><button type="button" role="switch" aria-checked={autoApplyEnabled} onClick={() => { setAutoApplyEnabled((value) => !value); setSaved(false); }} className={`ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${autoApplyEnabled ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>{autoApplyEnabled ? <PlayCircle size={17} /> : <PauseCircle size={17} />}{autoApplyEnabled ? "On" : "Paused"}</button></div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-800">Minimum match<input type="range" min="40" max="95" step="5" value={rules.minimumMatch} onChange={(event) => setRules((current) => ({ ...current, minimumMatch: Number(event.target.value) }))} className="mt-3 w-full accent-emerald-700" /><span className="mt-1 block text-sm font-bold text-brand-700">{rules.minimumMatch}% or higher</span></label>
              <label className="text-sm font-semibold text-slate-800">Minimum day rate<input type="number" min="0" max="3000" step="25" value={rules.minimumDayRate} onChange={(event) => setRules((current) => ({ ...current, minimumDayRate: Number(event.target.value) }))} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" /></label>
              <div className="text-sm font-semibold text-slate-800">
                <label htmlFor="daily-application-limit">Daily application limit</label>
                <div className="mt-2 flex gap-2">
                  <select
                    id="daily-application-limit"
                    value={rules.dailyLimit}
                    onChange={(event) => {
                      if (event.target.value === "premium") {
                        setShowPremiumNotice(true);
                        return;
                      }
                      setRules((current) => ({ ...current, dailyLimit: Number(event.target.value) }));
                      setSaved(false);
                    }}
                    className="ir35-focus min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-normal"
                  >
                    {Array.from({ length: maximumDailyLimit }, (_, index) => index + 1).map((limit) => (
                      <option key={limit} value={limit}>{limit} per day</option>
                    ))}
                    {!premiumActive && <option value="premium">More than 5, Premium</option>}
                  </select>
                  {!premiumActive && (
                    <button
                      type="button"
                      onClick={() => setShowPremiumNotice(true)}
                      className="ir35-focus inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700"
                    >
                      <LockKeyhole size={14} /> More
                    </button>
                  )}
                </div>
                <p className="mt-2 text-xs font-normal leading-5 text-slate-500">
                  {premiumActive
                    ? `Your Premium plan supports up to ${maximumDailyLimit} applications per day.`
                    : `Free accounts can run up to ${FREE_DAILY_APPLICATION_LIMIT} applications per day.`}
                </p>
              </div>
              <label className="text-sm font-semibold text-slate-800">Excluded companies<input value={rules.excludedCompanies.join(", ")} onChange={(event) => setRules((current) => ({ ...current, excludedCompanies: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} placeholder="Agency A, Company B" className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" /></label>
            </div>
            {showPremiumNotice && !premiumActive && (
              <div role="status" className="mt-5 flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-950">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-violet-700 shadow-sm">
                  <LockKeyhole size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">Premium plans are coming soon</p>
                  <p className="mt-1 text-sm leading-6 text-violet-900">
                    The free plan includes up to five applications per day. Higher daily limits will be available when Premium launches.
                  </p>
                </div>
                <button type="button" onClick={() => setShowPremiumNotice(false)} aria-label="Close Premium notice" className="ir35-focus rounded-lg p-1 text-violet-700 hover:bg-white">
                  <XCircle size={18} />
                </button>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
            <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-950">Role lanes</h2><p className="mt-1 text-sm text-slate-600">Create up to three focused role searches.</p></div>{lanes.length < 3 && <button type="button" onClick={() => setLanes((current) => [...current, newLane()])} className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-bold"><Plus size={15} /> Add lane</button>}</div>
            <div className="mt-5 space-y-4">{lanes.map((lane, index) => <article key={lane.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-950">Lane {index + 1}</p><div className="flex items-center gap-2"><label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={lane.enabled} onChange={(event) => updateLane(lane.id, { enabled: event.target.checked })} className="h-4 w-4 accent-emerald-700" /> Active</label>{lanes.length > 1 && <button type="button" onClick={() => setLanes((current) => current.filter((item) => item.id !== lane.id))} aria-label={`Remove lane ${index + 1}`} className="ir35-focus rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 size={15} /></button>}</div></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><input value={lane.role} onChange={(event) => updateLane(lane.id, { role: event.target.value })} placeholder="Role, for example DevOps" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm" /><input value={lane.keywords.join(", ")} onChange={(event) => updateLane(lane.id, { keywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="AWS, Terraform" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm" /><input value={lane.location} onChange={(event) => updateLane(lane.id, { location: event.target.value })} placeholder="United Kingdom" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm" /></div></article>)}</div>
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><h2 className="font-semibold">IR35 statuses</h2><div className="mt-4 space-y-2">{(["outside", "inside", "unknown"] as const).map((value) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm capitalize"><input type="checkbox" checked={rules.ir35.includes(value)} onChange={() => setRules((current) => ({ ...current, ir35: toggleArray(current.ir35, value) }))} className="h-5 w-5 accent-emerald-700" />{value === "unknown" ? "Status not stated" : `${value} IR35`}</label>)}</div></div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><h2 className="font-semibold">Working patterns</h2><div className="mt-4 space-y-2">{(["remote", "hybrid", "onsite", "unknown"] as const).map((value) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm capitalize"><input type="checkbox" checked={rules.workplaces.includes(value)} onChange={() => setRules((current) => ({ ...current, workplaces: toggleArray(current.workplaces, value) }))} className="h-5 w-5 accent-emerald-700" />{value}</label>)}</div></div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-brand-700" /><div><h2 className="font-semibold text-slate-950">Permission to apply</h2><p className="mt-1 text-sm leading-6 text-slate-600">Confirm once to use your approved profile, Resume and saved answers for these searches.</p></div></div><label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800"><input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} className="mt-1 h-5 w-5 accent-emerald-700" /><span><strong className="block text-slate-950">Allow IR35Careers to apply to my matching roles.</strong>I can pause Auto Apply or change these preferences at any time.</span></label></section>

          <div className="flex flex-col gap-3 sm:flex-row"><button type="button" onClick={() => void persistSettings()} disabled={busy !== null} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 disabled:opacity-50"><CheckCircle2 size={17} /> Save settings</button><button type="button" onClick={() => void runPreview()} disabled={busy !== null} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 disabled:opacity-50">{busy === "preview" ? <Loader2 className="animate-spin" size={17} /> : <Eye size={17} />} {busy === "preview" ? "Checking contracts" : "Preview matches"}</button><button type="button" onClick={() => void runAutoApply()} disabled={busy !== null || !autoApplyEnabled || !consentAccepted} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-40">{busy === "apply" ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} {busy === "apply" ? `Applying ${applyElapsedSeconds}s` : "Find and apply next"}</button>{saved && <span className="self-center text-sm font-semibold text-emerald-700">Saved</span>}</div>
          {notice && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900" role="status">{notice}</p>}
          {runError && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert">{runError}</p>}
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-max">
          <section className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white shadow-card"><p className="text-xs font-bold uppercase tracking-wide text-emerald-300">Latest match check</p>{latestRun ? <><p className="mt-3 text-4xl font-bold tabular-nums">{latestRun.matchingJobIds.length}</p><p className="mt-1 text-sm text-slate-300">contracts match your current rules</p><p className="mt-4 text-xs text-slate-400">Checked {new Date(latestRun.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p></> : <p className="mt-3 text-sm leading-6 text-slate-300">Preview current contracts before starting Auto Apply.</p>}</section>
          {latestRun && !isSupabaseConfigured() && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card"><h2 className="font-semibold">Decision log</h2><ul className="mt-4 space-y-3">{DEMO_JOBS.map((job) => { const skip = latestRun.skipped.find((item) => item.jobId === job.id); return <li key={job.id} className="flex gap-3 border-b border-slate-100 pb-3 last:border-0"><span className="mt-0.5">{skip ? <XCircle className="text-slate-400" size={17} /> : <CheckCircle2 className="text-emerald-600" size={17} />}</span><div><p className="text-sm font-semibold text-slate-800">{job.title}</p><p className="mt-1 text-xs text-slate-500">{skip?.reason ?? "Matches your saved rules"}</p></div></li>; })}</ul></section>}
        </aside>
      </div>
    </WorkspacePage>
  );
}
