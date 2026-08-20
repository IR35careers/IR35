"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Bell, BellRing, Check, Eye, Loader2, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { IR35Badge } from "@/components/ui/ir35-badge";
import { JobCardSkeleton, StatePanel } from "@/components/ui/state-panel";
import { buttonClassName } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { alertToPreviewApi, alertToSearch, type JobAlertFilter } from "@/lib/alerts";
import { formatPosted, formatRate, type JobListing } from "@/lib/job-types";
import { PROFILE_SKILL_OPTIONS } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { supabase } from "@/lib/supabase";

const PREVIEW_ALERTS: JobAlertFilter[] = [{
  id: "preview-outside-platform",
  name: "Outside platform contracts",
  q: "platform",
  ir35: "outside",
  remote: "hybrid",
  min_rate: 500,
  skills: ["AWS", "Terraform"],
}];

interface PreviewState {
  alertId: string;
  loading: boolean;
  jobs: JobListing[];
  total: number;
  error: string | null;
}

interface SearchResponse {
  jobs?: JobListing[];
  total?: number;
  error?: string;
}

function filterSummary(alert: JobAlertFilter): string {
  return [
    alert.ir35 && (alert.ir35 === "outside" ? "Outside IR35" : "Inside IR35"),
    alert.remote && (alert.remote === "onsite" ? "On-site" : `${alert.remote[0].toUpperCase()}${alert.remote.slice(1)}`),
    alert.min_rate && `£${alert.min_rate}+/day`,
    alert.q,
    ...alert.skills,
  ].filter(Boolean).join(" · ") || "Any UK contract";
}

function AlertsInner() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const configured = isSupabaseConfigured();
  const previewController = useRef<AbortController | null>(null);
  const [alerts, setAlerts] = useState<JobAlertFilter[]>(configured ? [] : PREVIEW_ALERTS);
  const [busy, setBusy] = useState(configured);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(searchParams.get("prefill") === "1");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [matchPreview, setMatchPreview] = useState<PreviewState | null>(null);
  const [name, setName] = useState("");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [ir35, setIr35] = useState(searchParams.get("ir35") ?? "");
  const [remote, setRemote] = useState(searchParams.get("remote") ?? "");
  const [minRate, setMinRate] = useState(Number(searchParams.get("min_rate") ?? "0"));
  const [skills, setSkills] = useState<string[]>((searchParams.get("skills") ?? "").split(",").map((skill) => skill.trim()).filter(Boolean));

  useEffect(() => () => previewController.current?.abort(), []);

  useEffect(() => {
    if (!configured) {
      setBusy(false);
      return;
    }
    if (!user) return;
    let active = true;
    setBusy(true);
    setError(null);
    void supabase
      .from("job_alerts")
      .select("id, name, q, ir35, remote, min_rate, skills")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error: loadError }: { data: JobAlertFilter[] | null; error: { message: string } | null }) => {
        if (!active) return;
        if (loadError) setError("Your saved alerts could not be loaded. Please retry.");
        else setAlerts(data ?? []);
        setBusy(false);
      });
    return () => { active = false; };
  }, [configured, user]);

  const reload = async () => {
    if (!configured || !user) return;
    const { data, error: loadError } = await supabase
      .from("job_alerts")
      .select("id, name, q, ir35, remote, min_rate, skills")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (loadError) throw new Error(loadError.message);
    setAlerts((data ?? []) as JobAlertFilter[]);
  };

  const resetForm = () => {
    setName("");
    setQ("");
    setIr35("");
    setRemote("");
    setMinRate(0);
    setSkills([]);
    setShowForm(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    const alert: JobAlertFilter = {
      id: globalThis.crypto?.randomUUID?.() ?? `alert-${Date.now()}`,
      name: name.trim() || "Untitled alert",
      q: q.trim() || null,
      ir35: ir35 || null,
      remote: remote || null,
      min_rate: minRate > 0 ? minRate : null,
      skills,
    };
    try {
      if (!configured) {
        setAlerts((current) => [alert, ...current]);
      } else {
        if (!user) throw new Error("Sign in before saving an alert.");
        const { error: saveError } = await supabase.from("job_alerts").insert({
          user_id: user.id,
          name: alert.name,
          q: alert.q,
          ir35: alert.ir35,
          remote: alert.remote,
          min_rate: alert.min_rate,
          skills: alert.skills,
        });
        if (saveError) throw saveError;
        await reload();
      }
      resetForm();
      setNotice(configured ? "Alert saved." : "Preview alert saved in this browser session.");
    } catch {
      setError("The alert could not be saved. Your form values are still here; please retry.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      return;
    }
    setError(null);
    try {
      if (!configured) {
        setAlerts((current) => current.filter((alert) => alert.id !== id));
      } else {
        if (!user) throw new Error("Sign in before deleting an alert.");
        const { error: deleteError } = await supabase.from("job_alerts").delete().eq("id", id).eq("user_id", user.id);
        if (deleteError) throw deleteError;
        await reload();
      }
      if (matchPreview?.alertId === id) setMatchPreview(null);
      setPendingDeleteId(null);
      setNotice("Alert deleted.");
    } catch {
      setError("The alert could not be deleted. Nothing was removed.");
    }
  };

  const previewMatches = async (alert: JobAlertFilter) => {
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setMatchPreview({ alertId: alert.id, loading: true, jobs: [], total: 0, error: null });
    try {
      const response = await fetch(alertToPreviewApi(alert), { signal: controller.signal });
      const body = (await response.json()) as SearchResponse;
      if (!response.ok || body.error) throw new Error(body.error ?? "Search is temporarily unavailable.");
      if (previewController.current !== controller) return;
      setMatchPreview({ alertId: alert.id, loading: false, jobs: body.jobs ?? [], total: body.total ?? 0, error: null });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (previewController.current !== controller) return;
      setMatchPreview({ alertId: alert.id, loading: false, jobs: [], total: 0, error: "Matching contracts could not be loaded. Please retry." });
    }
  };

  return (
    <WorkspacePage
      eyebrow="Saved discovery"
      title="Job alerts"
      description="Save focused searches and preview the latest matching contracts on demand. Delivery remains off until a verified email provider is connected."
      actions={<button type="button" onClick={() => setShowForm((value) => !value)} className={buttonClassName({ className: "w-full sm:w-auto" })}>{showForm ? <X size={16} /> : <Plus size={16} />}{showForm ? "Close form" : "New alert"}</button>}
    >
      <section className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white shadow-card sm:p-6">
        <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-300/10 text-emerald-300"><BellRing size={20} /></span><div><h2 className="font-semibold">Curated preview is ready</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">Open any saved alert to see its latest live matches. No email is sent, and no application is prepared or submitted.</p></div></div>
        <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 text-xs font-bold text-amber-200"><ShieldCheck size={15} /> Email not connected</span>
      </section>

      {(error || notice) && <p className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`} role={error ? "alert" : "status"}>{error ?? notice}</p>}

      {showForm && (
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Bell size={18} /></span><div><h2 className="font-semibold text-slate-950">Create a focused alert</h2><p className="text-sm text-slate-600">Every saved value becomes a live-search filter.</p></div></div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-semibold text-slate-800">Alert name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Outside React, £600+" maxLength={100} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 font-normal" /></label>
            <label className="text-sm font-semibold text-slate-800">Keyword<input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Developer or company" maxLength={120} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 font-normal" /></label>
            <label className="text-sm font-semibold text-slate-800">IR35<select value={ir35} onChange={(event) => setIr35(event.target.value)} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 font-normal"><option value="">Any status</option><option value="outside">Outside IR35</option><option value="inside">Inside IR35</option></select></label>
            <label className="text-sm font-semibold text-slate-800">Workplace<select value={remote} onChange={(event) => setRemote(event.target.value)} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 font-normal"><option value="">Any pattern</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select></label>
            <label className="text-sm font-semibold text-slate-800">Minimum day rate<select value={minRate} onChange={(event) => setMinRate(Number(event.target.value))} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 font-normal">{[0, 300, 400, 500, 600, 700].map((rate) => <option key={rate} value={rate}>{rate === 0 ? "Any rate" : `£${rate}+/day`}</option>)}</select></label>
          </div>
          <fieldset className="mt-5"><legend className="text-sm font-semibold text-slate-800">Skills</legend><div className="mt-2 flex flex-wrap gap-2">{PROFILE_SKILL_OPTIONS.slice(0, 18).map((skill) => { const selected = skills.includes(skill); return <button key={skill} type="button" aria-pressed={selected} onClick={() => setSkills((current) => selected ? current.filter((item) => item !== skill) : [...current, skill])} className={`ir35-focus min-h-10 rounded-full border px-3 text-xs font-semibold ${selected ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>{selected && <Check size={13} className="mr-1 inline" />}{skill}</button>; })}</div></fieldset>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={resetForm} className={buttonClassName({ variant: "secondary" })}>Cancel</button><button type="button" onClick={() => void save()} disabled={saving} className={buttonClassName()}>{saving ? <Loader2 className="animate-spin" size={16} /> : <Bell size={16} />}Save alert</button></div>
        </section>
      )}

      {busy ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2" aria-busy="true"><JobCardSkeleton /><JobCardSkeleton /><span className="sr-only">Loading saved alerts</span></div>
      ) : alerts.length === 0 && !showForm ? (
        <div className="mt-6"><StatePanel title="No alerts yet" body="Create a focused search to keep the roles you care about one click away." action={<button type="button" onClick={() => setShowForm(true)} className={buttonClassName()}><Plus size={16} />Create alert</button>} /></div>
      ) : (
        <div className="mt-6 grid gap-4">
          {alerts.map((alert) => {
            const selectedPreview = matchPreview?.alertId === alert.id ? matchPreview : null;
            return (
              <article key={alert.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card">
                <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0"><h2 className="truncate text-lg font-semibold text-slate-950">{alert.name}</h2><p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{filterSummary(alert)}</p></div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => void previewMatches(alert)} disabled={selectedPreview?.loading} className={buttonClassName({ variant: "secondary", size: "sm" })}>{selectedPreview?.loading ? <Loader2 className="animate-spin" size={15} /> : <Eye size={15} />}Preview matches</button>
                    <Link href={alertToSearch(alert)} className={buttonClassName({ variant: "primary", size: "sm" })}>Open search <ArrowRight size={14} /></Link>
                    <button type="button" onClick={() => void remove(alert.id)} aria-label={pendingDeleteId === alert.id ? `Confirm delete ${alert.name}` : `Delete ${alert.name}`} className={buttonClassName({ variant: pendingDeleteId === alert.id ? "danger" : "quiet", size: "sm" })}><Trash2 size={14} />{pendingDeleteId === alert.id ? "Confirm delete" : <span className="sr-only">Delete</span>}</button>
                  </div>
                </div>

                {selectedPreview && (
                  <div className="min-w-0 border-t border-slate-200 bg-slate-50 p-5 sm:p-6" aria-live="polite">
                    {selectedPreview.loading ? <div className="grid gap-3 lg:grid-cols-3"><JobCardSkeleton compact /><JobCardSkeleton compact /><JobCardSkeleton compact /></div> : selectedPreview.error ? <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-950"><p className="flex items-center gap-2 text-sm font-semibold"><AlertCircle size={16} />{selectedPreview.error}</p><button type="button" onClick={() => void previewMatches(alert)} className={buttonClassName({ variant: "secondary", size: "sm" })}>Retry</button></div> : <><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-950">{selectedPreview.total.toLocaleString()} current matches</p><p className="mt-0.5 text-xs text-slate-500">Showing up to three live roles. This preview does not send a notification.</p></div><Link href={alertToSearch(alert)} className="ir35-focus rounded-lg text-sm font-semibold text-brand-700">View all <ArrowRight className="inline" size={14} /></Link></div>{selectedPreview.jobs.length > 0 ? <div className="mt-4 grid min-w-0 gap-3 xl:grid-cols-3">{selectedPreview.jobs.map((job) => <Link key={job.id} href={`/jobs/${job.id}`} className="ir35-focus min-w-0 rounded-2xl border border-slate-200 bg-white p-4 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-brand-300"><div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-950">{job.title}</h3><p className="mt-1 truncate text-xs text-slate-500">{job.company_name} · {job.location}</p></div><span className="shrink-0 text-xs font-bold text-slate-950">{formatRate(job)}</span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><IR35Badge status={job.ir35_status} size="xs" /><span className="text-[11px] text-slate-500">{formatPosted(job)}</span></div></Link>)}</div> : <p className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">No active contracts currently match every saved filter. Broaden the alert or check again later.</p>}</>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </WorkspacePage>
  );
}

export default function AlertsPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500" aria-busy="true"><Loader2 className="animate-spin" size={22} /><span className="sr-only">Loading job alerts</span></main>}><AlertsInner /></Suspense>;
}
