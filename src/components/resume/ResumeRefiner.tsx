"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, FileText, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import type { JobDetail } from "@/lib/job-types";
import type { AiTailoringResult } from "@/lib/ai/tailoring-types";
import { buildLocalTailoringResult } from "@/lib/ai/local-tailoring";
import { fetchWithFreshSession } from "@/lib/authenticated-fetch";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { buildRefinedResumeDraft, type RefinedResumeDraft } from "@/lib/resume/refinement";
import { extractRoleKeywords, scoreResumeForRole } from "@/lib/resume/analysis";

export function ResumeRefiner({ job, resumeText, disabled = false, autoStart = false, actionLabel = "Use this version & review application", onUseDraft }: {
  job: JobDetail;
  resumeText: string;
  disabled?: boolean;
  autoStart?: boolean;
  actionLabel?: string;
  onUseDraft: (draft: RefinedResumeDraft) => Promise<void>;
}) {
  const [result, setResult] = useState<AiTailoringResult | null>(null);
  const [reviewSource, setReviewSource] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState("");
  const [evidenceConfirmed, setEvidenceConfirmed] = useState(false);
  const [busy, setBusy] = useState<"refine" | "save" | null>(null);
  const [mode, setMode] = useState("Local evidence review");
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sectionFilter, setSectionFilter] = useState("All edits");
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const stale = Boolean(result && reviewSource !== resumeText);
  const hasRoleKeywords = extractRoleKeywords(job).length > 0;
  const { draft, draftIssue } = useMemo(() => {
    if (!result) return { draft: null, draftIssue: "" };
    try { return { draft: buildRefinedResumeDraft({ sourceText: reviewSource, suggestions: result.suggestions,
      selectedIds: selected, replacements, evidence, evidenceConfirmed }), draftIssue: "" }; }
    catch (caught) { return { draft: null, draftIssue: caught instanceof Error ? caught.message : "Review these changes again." }; }
  }, [result, reviewSource, selected, replacements, evidence, evidenceConfirmed]);
  const score = useMemo(() => draft ? scoreResumeForRole(draft.tailoredText, job) : null, [draft, job]);

  const refine = async () => {
    requestRef.current?.abort();
    if (resumeText.trim().length < 120) { setError("Add your resume first; at least 120 characters are needed to review the evidence."); return; }
    const controller = new AbortController();
    requestRef.current = controller;
    setReviewSource(resumeText);
    setSelected([]); setReplacements({}); setSectionFilter("All edits"); setError(""); setBusy("refine");
    setMode("Local evidence review");
    setResult(buildLocalTailoringResult(resumeText, job));
    if (!isSupabaseConfigured()) { setBusy(null); return; }
    try {
      const response = await fetchWithFreshSession("/api/applications/tailor", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cvText: resumeText, job }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(42_000)]) });
      const payload = await response.json() as { result?: AiTailoringResult; mode?: string; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error || "Enhanced review is unavailable.");
      if (controller.signal.aborted) return;
      setResult(payload.result); setSelected([]); setReplacements({});
      setMode(payload.mode === "enhanced" ? "Enhanced review · contact details redacted" : "Local evidence review");
    } catch {
      if (!controller.signal.aborted) setMode("Enhanced review unavailable · local evidence review ready");
    } finally { if (requestRef.current === controller) { requestRef.current = null; setBusy((current) => current === "refine" ? null : current); } }
  };

  const started = useRef(false);
  const startReview = useEffectEvent(() => { void refine(); });
  useEffect(() => { if (autoStart && !started.current) { started.current = true; startReview(); } }, [autoStart]);

  const acceptDraft = async () => {
    if (disabled || stale || busy || !draft) return;
    setBusy("save"); setError("");
    try { await onUseDraft(draft); setResult(null); setSelected([]); setEvidence(""); setEvidenceConfirmed(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The draft could not be saved. Your current resume is unchanged."); }
    finally { setBusy(null); }
  };

  return (
    <section aria-label="Refine resume for this job" className="min-w-0 overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 shadow-[0_18px_50px_-40px_rgba(6,95,70,.5)]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-emerald-800"><Sparkles size={14} /> Role-specific resume refinement</p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">A stronger resume. Still entirely you.</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">Review the requirements, choose your edits, then use this version to apply. Your master resume stays unchanged.</p></div>
        <button type="button" onClick={() => void refine()} disabled={disabled || busy !== null} className="ir35-focus inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50">
          {busy === "refine" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{result ? "Refine again" : "Refine for this job"}</button>
      </div>
      {error && <p role="alert" className="mx-4 mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
      {disabled && <p className="px-4 pb-4 text-xs text-slate-600">This application is submitted or processing. Its resume is preserved.</p>}
      {result && <div className="space-y-4 border-t border-emerald-100 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-xs font-medium text-emerald-800"><ShieldCheck size={14} />{mode}</p>
          {busy === "refine" && <div className="flex items-center gap-2 text-xs text-slate-600" role="status">Reviewing wording…<button type="button" onClick={() => { requestRef.current?.abort(); requestRef.current = null; setBusy(null); }} className="ir35-focus min-h-11 rounded-lg px-2 font-semibold">Use local review</button></div>}</div>
        <div className="grid grid-cols-3 gap-2">
          {[{ label: "Resume match", value: hasRoleKeywords ? `${result.baseline.overall}% → ${score?.overall ?? result.baseline.overall}%` : "Not scored" }, { label: "Edits selected", value: String(selected.length) }, { label: "Evidence gaps", value: hasRoleKeywords ? String(result.baseline.missingKeywords.length) : "Review JD" }].map((item) => <div key={item.label} className="min-w-0 rounded-xl border border-white bg-white/80 p-3"><p className="text-base font-semibold tabular-nums text-slate-950 sm:text-xl">{item.value}</p><p className="mt-1 text-[10px] font-semibold text-slate-500">{item.label}</p></div>)}
        </div>
        <p className="text-[11px] leading-5 text-slate-500">The score measures keyword coverage, relevance, evidence and readability. It is not a hiring prediction or a guarantee of ATS success.</p>
        {!hasRoleKeywords && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">This listing has no recognised requirement tags. A numerical match and gap count are withheld. Review the full job description; wording suggestions do not establish that you meet its qualifications.</p>}
        <details className="rounded-xl border border-slate-200 bg-white p-3"><summary className="ir35-focus min-h-11 cursor-pointer text-sm font-semibold text-slate-800">Job description &amp; requirements</summary>
          <div className="mt-3 grid gap-4 lg:grid-cols-2"><div><p className="text-xs font-bold text-emerald-800">Priority requirements</p><ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-5 text-slate-700">{result.mustHaveRequirements.map((item) => <li key={item}>{item}</li>)}</ul>
            {result.niceToHaveRequirements.length > 0 && <><p className="mt-3 text-xs font-bold text-slate-700">Preferred</p><ul className="mt-1 list-inside list-disc text-xs leading-5">{result.niceToHaveRequirements.map((item) => <li key={item}>{item}</li>)}</ul></>}</div>
            <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-slate-600">{job.description || "No full description was supplied. Review the original posting before applying."}</p></div>
        </details>
        {result.baseline.missingKeywords.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3"><p className="text-xs font-bold text-amber-900">Not evidenced — never added automatically</p><p className="mt-1 text-xs leading-5 text-amber-900">{result.baseline.missingKeywords.join(" · ")}</p><p className="mt-2 text-xs leading-5 text-amber-800">Better wording cannot make you qualified for a different occupation, licence or clearance. Only add experience you genuinely have.</p></div>}
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-slate-950">Choose the changes you want</h4>
          <div className="flex gap-2"><button type="button" onClick={() => setSelected(result.suggestions.map((item) => item.id))} disabled={busy !== null} className="ir35-focus min-h-11 rounded-lg px-2 text-xs font-semibold text-emerald-800 disabled:opacity-50">Select all</button><button type="button" onClick={() => setSelected([])} className="ir35-focus min-h-11 rounded-lg px-2 text-xs font-semibold text-slate-600">Clear</button></div></div>
        {result.suggestions.length > 0 && <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="group" aria-label="Review edits by section">{["All edits", ...new Set(result.suggestions.map((item) => item.section))].map((section) => <button key={section} type="button" aria-pressed={sectionFilter === section} onClick={() => setSectionFilter(section)} className={`ir35-focus min-h-11 shrink-0 rounded-lg border px-3 text-xs font-semibold ${sectionFilter === section ? "border-emerald-800 bg-emerald-800 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{section}</button>)}</div>}
        <div className="space-y-3">{result.suggestions.filter((item) => sectionFilter === "All edits" || item.section === sectionFilter).map((suggestion) => {
          const index = result.suggestions.findIndex((item) => item.id === suggestion.id);
          const accepted = selected.includes(suggestion.id);
          return <article key={suggestion.id} className={`min-w-0 rounded-xl border bg-white p-3 sm:p-4 ${accepted ? "border-emerald-300" : "border-slate-200"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-900">{index + 1}. {suggestion.section} <span className="ml-1 text-[10px] font-normal text-slate-500">{suggestion.impact} impact</span></p>
              <button type="button" aria-pressed={accepted} aria-label={`Accept change ${index + 1}: ${suggestion.section}`} onClick={() => setSelected((items) => accepted ? items.filter((id) => id !== suggestion.id) : [...items, suggestion.id])} disabled={busy !== null} className={`ir35-focus inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-50 ${accepted ? "bg-emerald-700 text-white" : "border border-slate-200 text-slate-700"}`}>{accepted ? <Check size={14} /> : <X size={14} />}{accepted ? "Accepted · undo" : "Accept change"}</button></div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{suggestion.rationale}</p>
            <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2"><div className="min-w-0 rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Current wording</p><p className="mt-2 break-words whitespace-pre-wrap text-xs leading-6 text-slate-700">{suggestion.original || "New evidence-based summary"}</p></div>
              <div className="min-w-0 rounded-lg bg-emerald-50/70 p-3"><label className="block text-[10px] font-bold uppercase tracking-wide text-emerald-800">Suggested wording — editable<textarea aria-label={`Suggested wording ${index + 1}`} value={replacements[suggestion.id] ?? suggestion.replacement} onChange={(event) => setReplacements((items) => ({ ...items, [suggestion.id]: event.target.value }))} rows={4} maxLength={12000} className="ir35-focus mt-2 w-full resize-y rounded-lg border border-emerald-200 bg-white p-2 text-base font-normal normal-case leading-6 tracking-normal text-slate-800 sm:text-xs" /></label></div></div>
            <details className="mt-2 text-xs"><summary className="ir35-focus min-h-11 cursor-pointer font-medium text-slate-600">Source evidence</summary><p className="mt-2 break-words whitespace-pre-wrap rounded-lg bg-slate-50 p-3 leading-5 text-slate-600">{suggestion.evidenceQuote}</p></details>
          </article>;
        })}{result.suggestions.length === 0 && <p className="rounded-xl bg-white p-4 text-sm text-slate-600">No safe wording changes were found. You can keep your current resume or add your own factual evidence below.</p>}</div>
        <details className="rounded-xl border border-slate-200 bg-white p-3"><summary className="ir35-focus min-h-11 cursor-pointer text-sm font-semibold text-slate-800">Add real experience that is missing (optional)</summary>
          <label className="mt-3 block text-xs leading-5 text-slate-600">Describe what you actually did, where and with which tools. Do not invent employers, dates or results.<textarea aria-label="Additional factual experience" value={evidence} onChange={(event) => { setEvidence(event.target.value); setEvidenceConfirmed(false); }} rows={4} maxLength={8000} className="ir35-focus mt-2 w-full rounded-lg border border-slate-300 p-3 text-base text-slate-800 sm:text-sm" /></label>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={evidenceConfirmed} onChange={(event) => setEvidenceConfirmed(event.target.checked)} />I confirm this additional experience is accurate and mine.</label>
        </details>
        {stale && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Your current resume changed after this review. Refine again to avoid overwriting those edits.</p>}
        {draftIssue && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{draftIssue}</p>}
        <div className="flex flex-col gap-3 border-t border-emerald-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={() => setPreviewOpen((value) => !value)} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"><FileText size={15} />{previewOpen ? "Hide" : "Preview"} selected version</button>
          <button type="button" onClick={() => void acceptDraft()} disabled={disabled || stale || busy !== null || !draft || (!autoStart && draft.tailoredText === resumeText)} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy === "save" ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}{actionLabel}<ArrowRight size={15} /></button>
        </div>
        {previewOpen && draft && <pre aria-label="Selected resume preview" className="max-h-[480px] overflow-auto break-words whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 font-sans text-xs leading-6 text-slate-700">{draft.tailoredText}</pre>}
        <p className="text-[11px] leading-5 text-slate-500">Nothing is submitted here. You will confirm the final resume and application answers before it is sent. <Link href={`/jobs/${job.id}/resume`} className="font-semibold text-emerald-800 underline underline-offset-2">Open full resume studio</Link></p>
      </div>}
    </section>
  );
}
