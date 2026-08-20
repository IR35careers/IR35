"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  History,
  Loader2,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import type { JobDetail } from "@/lib/job-types";
import {
  analyseResumeForRole,
  applyResumeSuggestions,
  parseResumeText,
  scoreResumeForRole,
} from "@/lib/resume/analysis";
import {
  createResumeVersionId,
  deleteResumeVersion,
  loadResumeVersions,
  saveResumeVersion,
} from "@/lib/resume/store";
import type {
  ResumeAnalysis,
  ResumeExportRequest,
  ResumeScore,
  ResumeSuggestion,
  ResumeVersion,
  ResumeVersionStatus,
} from "@/lib/resume/types";
import { isSupabaseConfigured } from "@/lib/supabase-config";

type StudioPhase = "source" | "review" | "final";

const SAMPLE_NAME = "Alex Morgan";

function sampleResume(job: JobDetail): string {
  const evidenced = job.skills.slice(0, Math.max(2, Math.ceil(job.skills.length / 2)));
  return `${SAMPLE_NAME}
alex.morgan@example.com | +44 7700 900123 | linkedin.com/in/alexmorgan

PROFILE
Contract technology specialist with experience improving cloud platforms and delivery workflows.

TECHNICAL SKILLS
${[...evidenced, "Docker", "Git", "Agile"].join(" | ")}

PROFESSIONAL EXPERIENCE
Cloud Platform Consultant | UK Digital Programme | 2023 - Present
- I was responsible for improving ${evidenced[0] ?? "cloud"} platform reliability across production services
- I worked on reusable ${evidenced[1] ?? "delivery"} components for engineering teams
- Supported incident reviews and reduced recurring deployment failures by 28%
- Partnered with delivery leads to document operational controls

DevOps Engineer | Commerce Platform | 2020 - 2023
- Built automated delivery pipelines used by six product teams
- Helped with cloud cost reviews that identified 18% annual savings

EDUCATION
BSc Computing

CERTIFICATIONS
Cloud practitioner certification`;
}

function ScoreRing({ score, size = 92 }: { score: number; size?: number }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const colour = score >= 75 ? "#087a5b" : score >= 55 ? "#d97706" : "#e11d48";
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="46" cy="46" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx="46"
          cy="46"
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute text-xl font-bold tabular-nums text-slate-950">{score}%</span>
    </span>
  );
}

function ScoreBreakdown({ score }: { score: ResumeScore }) {
  const rows = [
    ["Role keywords", score.breakdown.keywordCoverage, "45%"],
    ["Evidence strength", score.breakdown.evidenceStrength, "25%"],
    ["Role relevance", score.breakdown.roleRelevance, "15%"],
    ["ATS readability", score.breakdown.atsReadability, "15%"],
  ] as const;
  return (
    <div className="space-y-3">
      {rows.map(([label, value, weight]) => (
        <div key={label}>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-slate-700">{label} <span className="font-normal text-slate-600">({weight})</span></span>
            <span className="font-semibold tabular-nums text-slate-900">{value}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${value}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StepRail({ phase }: { phase: StudioPhase }) {
  const active = phase === "source" ? 1 : phase === "review" ? 2 : 3;
  const steps = ["Add CV", "Review evidence", "Approve & export"];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="CV tailoring progress">
      {steps.map((label, index) => {
        const number = index + 1;
        const complete = number < active;
        const current = number === active;
        return (
          <li key={label} className="min-w-0">
            <div className={`h-1 rounded-full ${number <= active ? "bg-brand-600" : "bg-slate-200"}`} />
            <p className={`mt-2 truncate text-xs font-semibold ${current ? "text-brand-700" : complete ? "text-slate-700" : "text-slate-500"}`}>
              {complete ? <Check size={12} className="mr-1 inline" aria-hidden="true" /> : `${number}. `}{label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function SuggestionCard({
  suggestion,
  accepted,
  confirmed,
  onToggle,
}: {
  suggestion: ResumeSuggestion;
  accepted: boolean;
  confirmed: boolean;
  onToggle: (suggestion: ResumeSuggestion) => void;
}) {
  const active = suggestion.requiresConfirmation ? confirmed : accepted;
  return (
    <article className={`rounded-2xl border p-4 transition-colors ${active ? "border-brand-200 bg-brand-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {suggestion.kind === "verified-keyword" ? <ShieldCheck size={15} className="text-amber-600" /> : <WandSparkles size={15} className="text-brand-600" />}
            {suggestion.title}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">{suggestion.rationale}</p>
        </div>
        <button
          type="button"
          onClick={() => onToggle(suggestion)}
          aria-pressed={active}
          className={`ir35-focus inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold ${
            active
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
          }`}
        >
          {active ? <CheckCircle2 size={14} /> : null}
          {suggestion.requiresConfirmation ? (active ? "Experience confirmed" : "I genuinely have this") : active ? "Approved" : "Use suggestion"}
        </button>
      </div>

      {suggestion.kind === "verified-keyword" ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">CV evidence</p>
            <p className="mt-1 text-sm text-slate-600">{suggestion.original}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">Add only after confirmation</p>
            <p className="mt-1 text-sm font-semibold text-amber-950">{suggestion.replacement}</p>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Original</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{suggestion.original || "No profile section found."}</p>
          </div>
          <div className="rounded-xl border border-brand-200 bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">Suggested</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-800">{suggestion.replacement}</p>
          </div>
        </div>
      )}
    </article>
  );
}

function formatVersionDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function ResumeStudio({ job, backHref, forceLocalHistory = false }: { job: JobDetail; backHref?: string; forceLocalHistory?: boolean }) {
  const { user } = useAuth();
  const historyUserId = forceLocalHistory ? null : user?.id ?? null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<StudioPhase>("source");
  const [sourceText, setSourceText] = useState("");
  const [sourceFilename, setSourceFilename] = useState("Pasted CV");
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [confirmedIds, setConfirmedIds] = useState<string[]>([]);
  const [tailoredText, setTailoredText] = useState("");
  const [versionLabel, setVersionLabel] = useState("Role-tailored CV");
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [busy, setBusy] = useState<"parse" | "save" | "approve" | "pdf" | "docx" | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshVersions = async () => {
    try {
      setVersions(await loadResumeVersions(job.id, historyUserId));
    } catch (versionError) {
      setError(versionError instanceof Error ? versionError.message : "Version history is unavailable.");
    }
  };

  useEffect(() => {
    void refreshVersions();
    // job and signed-in user determine the private history scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, historyUserId]);

  const previewText = useMemo(() => {
    if (!analysis) return sourceText;
    return applyResumeSuggestions(sourceText, analysis.suggestions, acceptedIds, confirmedIds);
  }, [acceptedIds, analysis, confirmedIds, sourceText]);

  const previewScore = useMemo(
    () => (analysis ? scoreResumeForRole(previewText, job, sourceFilename) : null),
    [analysis, job, previewText, sourceFilename]
  );

  const finalScore = useMemo(
    () => (tailoredText.trim() ? scoreResumeForRole(tailoredText, job, sourceFilename) : null),
    [job, sourceFilename, tailoredText]
  );

  const parseAndSetFile = async (file: File) => {
    setError("");
    setNotice("");
    if (file.size > 5 * 1024 * 1024) {
      setError("CV must be under 5MB.");
      return;
    }
    setBusy("parse");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/resume/parse", { method: "POST", body: formData });
      const payload = (await response.json()) as { text?: string; filename?: string; error?: string; warnings?: string[] };
      if (!response.ok || !payload.text) throw new Error(payload.error ?? "CV could not be read.");
      setSourceText(payload.text);
      setSourceFilename(payload.filename ?? file.name);
      if (payload.warnings?.length) setNotice("The CV was read, but some Word formatting was simplified for analysis.");
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "CV could not be read.");
    } finally {
      setBusy(null);
    }
  };

  const runAnalysis = () => {
    setError("");
    setNotice("");
    if (sourceText.trim().length < 120) {
      setError("Add at least 120 characters of CV text so the score has enough evidence.");
      return;
    }
    const next = analyseResumeForRole(sourceText, sourceFilename, job);
    setAnalysis(next);
    setAcceptedIds(next.defaultAcceptedIds);
    setConfirmedIds([]);
    setPhase("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleSuggestion = (suggestion: ResumeSuggestion) => {
    if (suggestion.requiresConfirmation) {
      setConfirmedIds((current) =>
        current.includes(suggestion.id) ? current.filter((id) => id !== suggestion.id) : [...current, suggestion.id]
      );
      setAcceptedIds((current) =>
        current.includes(suggestion.id) ? current.filter((id) => id !== suggestion.id) : [...current, suggestion.id]
      );
      return;
    }
    setAcceptedIds((current) =>
      current.includes(suggestion.id) ? current.filter((id) => id !== suggestion.id) : [...current, suggestion.id]
    );
  };

  const buildApprovedDraft = () => {
    setTailoredText(previewText);
    setPhase("final");
    setNotice("Approved suggestions applied. You can still edit every line before saving or exporting.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const makeVersion = (status: ResumeVersionStatus): ResumeVersion | null => {
    if (!analysis || !finalScore) return null;
    const now = new Date().toISOString();
    return {
      id: createResumeVersionId(),
      userId: user?.id ?? null,
      jobId: job.id,
      jobTitle: job.title,
      companyName: job.company_name,
      sourceFilename,
      label: versionLabel.trim() || "Role-tailored CV",
      status,
      sourceText,
      tailoredText,
      acceptedSuggestionIds: acceptedIds,
      confirmedKeywordIds: confirmedIds,
      score: finalScore,
      createdAt: now,
      approvedAt: status === "approved" ? now : null,
    };
  };

  const persistVersion = async (status: ResumeVersionStatus) => {
    const version = makeVersion(status);
    if (!version) return;
    setBusy(status === "approved" ? "approve" : "save");
    setError("");
    try {
      await saveResumeVersion(version, historyUserId);
      await refreshVersions();
      setNotice(status === "approved" ? "Version approved and saved. It is ready to export." : "Draft version saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Version could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const exportVersion = async (format: "pdf" | "docx") => {
    const parsed = parseResumeText(tailoredText, sourceFilename);
    const payload: ResumeExportRequest = {
      format,
      resumeText: tailoredText,
      candidateName: parsed.candidateName,
      jobTitle: job.title,
      companyName: job.company_name,
      versionLabel: versionLabel.trim() || "Approved version",
    };
    setBusy(format);
    setError("");
    try {
      const response = await fetch("/api/resume/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? "Export failed.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `tailored-cv.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`${format.toLocaleUpperCase("en-GB")} downloaded from the version currently shown.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  };

  const restoreVersion = (version: ResumeVersion) => {
    const nextAnalysis = analyseResumeForRole(version.sourceText, version.sourceFilename, job);
    setSourceText(version.sourceText);
    setSourceFilename(version.sourceFilename);
    setAnalysis(nextAnalysis);
    setAcceptedIds(version.acceptedSuggestionIds);
    setConfirmedIds(version.confirmedKeywordIds);
    setTailoredText(version.tailoredText);
    setVersionLabel(version.label);
    setPhase("final");
    setNotice(`Restored ${version.label}. Saving creates a new version; the original remains unchanged.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeVersion = async (version: ResumeVersion) => {
    setError("");
    try {
      await deleteResumeVersion(version.id, historyUserId);
      await refreshVersions();
      setNotice(`Deleted ${version.label}.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Version could not be deleted.");
    }
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 pb-16 text-slate-950">
      <div className="ir35-container py-6 sm:py-8">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href={backHref ?? `/jobs/${job.id}`} className="ir35-focus inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-950">
              <ArrowLeft size={15} /> Back to role
            </Link>
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-brand-700">CV Studio</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Tailor your CV with evidence you control</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
              {job.title} at {job.company_name}. Scores are transparent, missing keywords are never treated as experience, and every edit needs your approval.
            </p>
          </div>
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-card lg:w-[390px]">
            <StepRail phase={phase} />
          </div>
        </div>

        {(error || notice) && (
          <div className={`mt-5 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-brand-200 bg-brand-50 text-brand-900"}`} role={error ? "alert" : "status"}>
            {error ? <AlertTriangle size={17} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0" />}
            <span>{error || notice}</span>
            <button type="button" onClick={() => { setError(""); setNotice(""); }} className="ir35-focus ml-auto rounded p-1" aria-label="Dismiss message"><X size={15} /></button>
          </div>
        )}

        {phase === "source" && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-7" aria-labelledby="add-cv-title">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><FileText size={19} /></span>
                <div>
                  <h2 id="add-cv-title" className="text-lg font-bold">Add the CV you want to tailor</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">PDF, DOCX or plain text, up to 5MB. Files are read for this analysis and are not retained by the parser.</p>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                aria-label="Upload CV file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                className="sr-only"
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void parseAndSetFile(file); }}
              />
              <div
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
                onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void parseAndSetFile(file); }}
                className={`mt-6 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50"}`}
              >
                {busy === "parse" ? <Loader2 className="mx-auto animate-spin text-brand-700" size={25} /> : <UploadCloud className="mx-auto text-slate-500" size={27} />}
                <p className="mt-3 text-sm font-semibold text-slate-900">{busy === "parse" ? "Reading your CV…" : "Drop your CV here"}</p>
                <p className="mt-1 text-xs text-slate-500">or</p>
                <button type="button" disabled={busy === "parse"} onClick={() => fileInputRef.current?.click()} className="ir35-focus mt-2 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-50">
                  Choose a file
                </button>
                {sourceFilename !== "Pasted CV" && sourceText && <p className="mt-3 text-xs font-medium text-brand-700">Ready: {sourceFilename}</p>}
              </div>

              <div className="my-5 flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-200" />or paste the text<span className="h-px flex-1 bg-slate-200" /></div>
              <label htmlFor="cv-source" className="text-sm font-semibold text-slate-800">CV text</label>
              <textarea
                id="cv-source"
                value={sourceText}
                onChange={(event) => { setSourceText(event.target.value); setSourceFilename("Pasted CV"); }}
                rows={14}
                placeholder="Paste your CV here. Keep the headings and bullet points so the readability check can assess the structure."
                className="ir35-focus mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm leading-6 text-slate-800 placeholder:font-sans placeholder:text-slate-400"
              />
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => { setSourceText(sampleResume(job)); setSourceFilename("Alex-Morgan-sample-CV.txt"); setNotice("Sample CV loaded. It is fictional and labelled for preview testing."); }} className="ir35-focus min-h-11 rounded-xl text-left text-sm font-semibold text-brand-700 hover:text-brand-800">
                  Try the labelled sample CV
                </button>
                <button type="button" onClick={runAnalysis} disabled={busy === "parse" || sourceText.trim().length < 120} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white shadow-card hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
                  <Sparkles size={16} /> Analyse against this role
                </button>
              </div>
            </section>

            <aside className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Scoring rubric</p>
                <h2 className="mt-2 text-base font-bold">No hidden “AI score”</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">The rating is a deterministic, inspectable calculation. It does not predict hiring success.</p>
                <div className="mt-4 space-y-3 text-sm">
                  {[["45%", "Role-keyword coverage"], ["25%", "Evidence strength"], ["15%", "Role relevance"], ["15%", "ATS readability"]].map(([value, label]) => (
                    <div key={label} className="flex items-center justify-between gap-3"><span className="text-slate-600">{label}</span><span className="font-bold tabular-nums text-slate-900">{value}</span></div>
                  ))}
                </div>
              </section>
              <section className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
                <p className="flex items-center gap-2 text-sm font-bold text-brand-900"><LockKeyhole size={16} /> Privacy by default</p>
                <p className="mt-2 text-sm leading-6 text-brand-900/80">
                  {user && isSupabaseConfigured()
                    ? "Versions you choose to save are stored in your private, row-protected account history."
                    : "You are using local mode. Versions are saved in this browser only when you press Save; you can delete them at any time."}
                </p>
              </section>
              {versions.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-bold"><History size={16} className="text-brand-700" /> Resume a saved version</p>
                    <span className="text-xs text-slate-500">{versions.length}</span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {versions.slice(0, 3).map((version) => (
                      <li key={version.id}>
                        <button type="button" onClick={() => restoreVersion(version)} className="ir35-focus w-full rounded-xl border border-slate-200 p-3 text-left hover:border-brand-200 hover:bg-brand-50/40">
                          <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-900"><span className="truncate">{version.label}</span><span className="tabular-nums text-brand-700">{version.score.overall}%</span></span>
                          <span className="mt-1 block text-xs text-slate-600">{formatVersionDate(version.createdAt)} · {version.status}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          </div>
        )}

        {phase === "review" && analysis && previewScore && (
          <div className="mt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
                <div className="flex items-center gap-4"><ScoreRing score={analysis.baseline.overall} /><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Current CV</p><h2 className="mt-1 text-lg font-bold">Role-specific score</h2><p className="mt-1 text-sm text-slate-600">Before approved changes</p></div></div>
              </section>
              <section className="rounded-2xl border border-brand-200 bg-brand-50/60 p-5 shadow-card">
                <div className="flex items-center gap-4"><ScoreRing score={previewScore.overall} /><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Live projection</p><h2 className="mt-1 text-lg font-bold">{previewScore.overall - analysis.baseline.overall >= 0 ? "+" : ""}{previewScore.overall - analysis.baseline.overall} points</h2><p className="mt-1 text-sm text-slate-600">Based only on approved or confirmed edits</p></div></div>
              </section>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Side-by-side approval</p><h2 className="mt-1 text-xl font-bold">Review every suggested change</h2><p className="mt-1 text-sm text-slate-600">Green edits use evidence already in the CV. Amber skills require your explicit confirmation.</p></div>
                  <button type="button" onClick={() => setPhase("source")} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"><RotateCcw size={15} /> Change source CV</button>
                </div>
                <div className="mt-4 space-y-3">
                  {analysis.suggestions.length ? analysis.suggestions.map((suggestion) => (
                    <SuggestionCard key={suggestion.id} suggestion={suggestion} accepted={acceptedIds.includes(suggestion.id)} confirmed={confirmedIds.includes(suggestion.id)} onToggle={toggleSuggestion} />
                  )) : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No safe changes were identified. You can still edit the final version manually.</div>}
                </div>
                <div className="sticky bottom-4 mt-5 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-floating backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-600"><span className="font-bold text-slate-900">{acceptedIds.length}</span> suggestions selected; <span className="font-bold text-slate-900">{confirmedIds.length}</span> new skills personally confirmed.</p>
                    <button type="button" onClick={buildApprovedDraft} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700"><FileCheck2 size={17} /> Build approved version</button>
                  </div>
                </div>
              </section>

              <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><p className="text-sm font-bold">Projected score details</p><div className="mt-4"><ScoreBreakdown score={previewScore} /></div></section>
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-sm font-bold text-slate-900">Keyword evidence</p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Found in CV</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">{analysis.baseline.matchedKeywords.length ? analysis.baseline.matchedKeywords.map((keyword) => <span key={keyword} className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800">{keyword}</span>) : <span className="text-xs text-slate-500">No role keywords found yet.</span>}</div>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-amber-700">Missing - not assumed</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">{analysis.baseline.missingKeywords.length ? analysis.baseline.missingKeywords.map((keyword) => <span key={keyword} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">{keyword}</span>) : <span className="text-xs text-slate-500">No priority gaps found.</span>}</div>
                </section>
              </aside>
            </div>
          </div>
        )}

        {phase === "final" && analysis && finalScore && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-7">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Final review</p><h2 className="mt-1 text-xl font-bold">Your approved, editable CV</h2><p className="mt-1 text-sm leading-6 text-slate-600">Read every line. Edit anything you would not confidently explain to a client or recruiter.</p></div>
                <button type="button" onClick={() => setPhase("review")} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"><ArrowLeft size={15} /> Review suggestions</button>
              </div>
              <label htmlFor="version-label" className="mt-6 block text-sm font-semibold text-slate-800">Version name</label>
              <input id="version-label" value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} maxLength={80} className="ir35-focus mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900" />
              <label htmlFor="tailored-cv" className="mt-5 block text-sm font-semibold text-slate-800">Tailored CV text</label>
              <textarea id="tailored-cv" value={tailoredText} onChange={(event) => setTailoredText(event.target.value)} rows={30} className="ir35-focus mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-slate-50 px-4 py-4 font-mono text-sm leading-6 text-slate-800" />
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={() => void persistVersion("draft")} disabled={busy !== null} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 hover:border-slate-400 disabled:opacity-50">{busy === "save" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save new version</button>
                <button type="button" onClick={() => void persistVersion("approved")} disabled={busy !== null} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">{busy === "approve" ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={17} />} Approve & save version</button>
              </div>
            </section>

            <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
              <section className="rounded-2xl border border-brand-200 bg-brand-50/50 p-5 shadow-card">
                <div className="flex items-center gap-4"><ScoreRing score={finalScore.overall} size={82} /><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Current editor score</p><p className="mt-1 text-lg font-bold">Role-specific rating</p><p className="text-xs text-slate-600">Updates as you edit</p></div></div>
                <div className="mt-5"><ScoreBreakdown score={finalScore} /></div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
                <p className="flex items-center gap-2 text-sm font-bold"><Download size={16} className="text-brand-700" /> Export this version</p>
                <p className="mt-2 text-xs leading-5 text-slate-600">Exports use the text currently shown, including your manual edits.</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => void exportVersion("pdf")} disabled={busy !== null} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">{busy === "pdf" ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} PDF</button>
                  <button type="button" onClick={() => void exportVersion("docx")} disabled={busy !== null} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 hover:border-slate-400 disabled:opacity-50">{busy === "docx" ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} DOCX</button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
                <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-bold"><History size={16} className="text-brand-700" /> Version history</p><span className="text-xs text-slate-500">{versions.length}</span></div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{!forceLocalHistory && user && isSupabaseConfigured() ? "Private account history" : "Stored only in this browser"}</p>
                {versions.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Save a draft or approved version to start the history.</p> : (
                  <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                    {versions.map((version) => (
                      <li key={version.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{version.label}</p><p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500"><Clock3 size={11} /> {formatVersionDate(version.createdAt)}</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${version.status === "approved" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{version.status}</span></div>
                        <div className="mt-3 flex items-center justify-between gap-2"><span className="text-xs font-bold tabular-nums text-slate-700">{version.score.overall}% score</span><div className="flex items-center gap-1"><button type="button" onClick={() => restoreVersion(version)} className="ir35-focus min-h-9 rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50">Restore</button><button type="button" onClick={() => void removeVersion(version)} className="ir35-focus inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700" aria-label={`Delete ${version.label}`}><Trash2 size={14} /></button></div></div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
