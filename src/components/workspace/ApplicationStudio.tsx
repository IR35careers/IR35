"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FileText,
  Flag,
  Loader2,
  LockKeyhole,
  MapPin,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  WandSparkles,
} from "lucide-react";
import { WorkspacePage, StatusPill } from "@/components/workspace/WorkspacePage";
import type { JobDetail } from "@/lib/job-types";
import { newWorkspaceId, reviewApplicationReceipt } from "@/lib/workspace/engine";
import { SAMPLE_CONTRACTOR_PROFILE, SAMPLE_CV_TEXT } from "@/lib/workspace/seed";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { ApplicationRecord, ApplicationReceiptReviewItem } from "@/lib/workspace/types";

const REVIEW_ITEMS: Array<{ id: ApplicationReceiptReviewItem; label: string }> = [
  { id: "cv", label: "CV version" },
  { id: "cover_letter", label: "Cover letter" },
  { id: "screening_answers", label: "Screening answers" },
  { id: "destination", label: "Destination" },
  { id: "other", label: "Something else" },
];

const WORKFLOW_STEPS = [
  { label: "Evidence", helper: "Choose your CV" },
  { label: "Tailor", helper: "Check role fit" },
  { label: "Review", helper: "Approve answers" },
  { label: "Receipt", helper: "Create handoff" },
] as const;

function persistApplication(application: ApplicationRecord) {
  updateWorkspace((current) => ({
    ...current,
    applications: [application, ...current.applications.filter((item) => item.id !== application.id)],
  }));
}

export function ApplicationStudio({ job }: { job: JobDetail }) {
  const workspace = useWorkspaceState();
  const existing = workspace.applications.find((item) => item.job.id === job.id && item.id !== "app-demo-northstar");
  const [cvText, setCvText] = useState(existing?.sourceCvText ?? "");
  const [application, setApplication] = useState<ApplicationRecord | null>(existing ?? null);
  const [busy, setBusy] = useState<"prepare" | "receipt" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState<"accurate" | "changes_needed">(existing?.receipt?.review?.outcome ?? "accurate");
  const [reviewFlags, setReviewFlags] = useState<ApplicationReceiptReviewItem[]>(existing?.receipt?.review?.flaggedItems ?? []);
  const [reviewNotes, setReviewNotes] = useState(existing?.receipt?.review?.notes ?? "");
  const reviewedSnapshot = application?.receipt?.reviewedSnapshot ?? (application ? {
    resumeVersionLabel: application.resumeVersionLabel,
    cvText: application.tailoredCvText,
    coverLetter: application.coverLetter,
    answers: application.questions.map(({ id, label, answer, source }) => ({ id, label, answer, source })),
  } : null);
  const cvReady = cvText.trim().length >= 120;
  const answersReviewed = Boolean(application?.questions.every((item) => !item.required || (item.reviewed && item.answer.trim().length > 0)));
  const approvalsComplete = Boolean(application?.truthApproved && application.materialsApproved && application.submissionApproved);
  const workflowComplete = [cvReady, Boolean(application), answersReviewed && approvalsComplete, Boolean(application?.receipt)];
  const checklistComplete = [cvReady, Boolean(application), answersReviewed, approvalsComplete, Boolean(application?.receipt)];
  const nextIncompleteStep = workflowComplete.findIndex((done) => !done);
  const activeStep = nextIncompleteStep === -1 ? WORKFLOW_STEPS.length - 1 : nextIncompleteStep;
  const progress = Math.round((checklistComplete.filter(Boolean).length / checklistComplete.length) * 100);

  const updateApplication = (updater: (current: ApplicationRecord) => ApplicationRecord) => {
    if (!application) return;
    const next = { ...updater(application), updatedAt: new Date().toISOString() };
    setApplication(next);
    persistApplication(next);
  };

  const prepare = async () => {
    setError(null);
    setNotice(null);
    setBusy("prepare");
    try {
      const response = await fetch("/api/applications/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job,
          profile: workspace.profile ?? SAMPLE_CONTRACTOR_PROFILE,
          cvText,
          resumeVersionLabel: workspace.profile.defaultCvLabel || "Application CV",
        }),
      });
      const payload = (await response.json()) as { application?: ApplicationRecord; error?: string };
      if (!response.ok || !payload.application) throw new Error(payload.error ?? "Could not prepare the application.");
      setApplication(payload.application);
      persistApplication(payload.application);
      setNotice("Application packet prepared. Nothing has been sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare the application.");
    } finally {
      setBusy(null);
    }
  };

  const createReceipt = async () => {
    if (!application) return;
    setError(null);
    setBusy("receipt");
    try {
      const response = await fetch("/api/applications/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application, approval: "APPROVE_DRY_RUN" }),
      });
      const payload = (await response.json()) as { receipt?: ApplicationRecord["receipt"]; error?: string };
      if (!response.ok || !payload.receipt) throw new Error(payload.error ?? "Could not create the receipt.");
      const now = new Date().toISOString();
      const next: ApplicationRecord = {
        ...application,
        status: "ready",
        receipt: payload.receipt,
        updatedAt: now,
        events: [
          ...application.events,
          { id: newWorkspaceId(), applicationId: application.id, type: "approved", label: "Dry-run packet approved and receipt created", createdAt: now },
        ],
      };
      setApplication(next);
      persistApplication(next);
      setNotice("Dry-run receipt created. No application or personal data was sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the receipt.");
    } finally {
      setBusy(null);
    }
  };

  const saveReceiptReview = () => {
    if (!application?.receipt) return;
    setError(null);
    try {
      updateApplication((current) => current.receipt ? {
        ...current,
        receipt: reviewApplicationReceipt(current.receipt, {
          outcome: reviewOutcome,
          flaggedItems: reviewFlags,
          notes: reviewNotes,
        }),
        events: [
          ...current.events,
          {
            id: newWorkspaceId(),
            applicationId: current.id,
            type: "note",
            label: reviewOutcome === "accurate" ? "Receipt reviewed as accurate" : "Receipt feedback saved for future preparation",
            createdAt: new Date().toISOString(),
          },
        ],
      } : current);
      setNotice("Receipt feedback saved to this application.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save receipt feedback.");
    }
  };

  return (
    <WorkspacePage
      density="compact"
      eyebrow="Application / review"
      title={`Prepare for ${job.company_name}`}
      description="Build a role-specific packet from evidence you control. Every answer and edit stays visible until you approve it."
      actions={<Link href={`/jobs/${job.id}`} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"><ArrowLeft size={15} /> Role details</Link>}
    >
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-card" aria-labelledby="application-role-title">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-lg font-bold text-white">{job.company_name.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="application-role-title" className="text-lg font-semibold tracking-tight text-slate-950 sm:text-xl">{job.title}</h2>
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${job.ir35_status === "outside" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : job.ir35_status === "inside" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{job.ir35_status === "unknown" ? "IR35 TBC" : `${job.ir35_status} IR35`}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                <span className="inline-flex items-center gap-1.5"><Building2 size={14} aria-hidden="true" />{job.company_name}</span>
                <span className="inline-flex items-center gap-1.5"><MapPin size={14} aria-hidden="true" />{job.location} · {job.remote_type}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            {application && <span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">{application.matchScore}% match</span>}
            {application && <StatusPill status={application.status} />}
          </div>
        </div>

        <div className="border-t border-slate-200 bg-[#fafaf9] p-3 sm:p-4">
          <ol className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Application preparation progress">
            {WORKFLOW_STEPS.map((step, index) => {
              const done = workflowComplete[index];
              const active = index === activeStep;
              return (
                <li key={step.label} aria-current={active ? "step" : undefined} className={`flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-3 transition-colors ${active ? "border-slate-950 bg-slate-950 text-white" : done ? "border-brand-200 bg-brand-50 text-brand-950" : "border-slate-200 bg-white text-slate-500"}`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${active ? "border-white/25 bg-white/10" : done ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white"}`}>{done ? <Check size={14} aria-hidden="true" /> : `0${index + 1}`}</span>
                  <span className="min-w-0"><span className="block text-xs font-bold">{step.label}</span><span className={`block truncate text-[10px] ${active ? "text-slate-300" : "text-slate-500"}`}>{step.helper}</span></span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {(error || notice) && <p role={error ? "alert" : "status"} className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error ?? notice}</p>}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {!application ? (
            <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-card">
              <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><FileText size={19} /></span>
                  <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">Step 01 · Evidence</p><h2 className="mt-0.5 font-semibold text-slate-950">1. Choose the CV evidence</h2></div>
                </div>
              </div>
              <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
                <div className="p-5 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div><h3 className="text-sm font-semibold text-slate-950">Paste the CV you want to use</h3><p className="mt-1 text-xs leading-5 text-slate-500">We compare only this evidence with the role. Nothing is invented or silently added.</p></div>
                    <button type="button" onClick={() => { setCvText(SAMPLE_CV_TEXT); setNotice("Fictional sample CV loaded for local testing."); }} className="ir35-focus inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 text-xs font-bold text-brand-800 hover:bg-brand-100"><Sparkles size={14} aria-hidden="true" /> Load labelled sample CV</button>
                  </div>
                  <div className="relative mt-4">
                    <textarea
                      value={cvText}
                      onChange={(event) => setCvText(event.target.value)}
                      rows={11}
                      maxLength={80_000}
                      aria-label="CV text for this application"
                      placeholder="Paste your CV text here…"
                      className="ir35-focus w-full resize-y rounded-2xl border border-slate-300 bg-[#f7f7f5] p-4 pb-10 font-mono text-sm leading-6 text-slate-800 placeholder:text-slate-400"
                    />
                    <span className="pointer-events-none absolute bottom-3 right-4 text-[10px] font-medium text-slate-400">{cvText.length.toLocaleString("en-GB")} / 80,000</span>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className={`text-xs font-medium ${cvReady ? "text-brand-700" : "text-slate-500"}`}>{cvReady ? "Ready to compare with this role" : "Add at least 120 characters to continue"}</p>
                    <button type="button" onClick={prepare} disabled={busy !== null || !cvReady} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
                      {busy === "prepare" ? <Loader2 className="animate-spin" size={17} /> : <WandSparkles size={17} />} Prepare application
                    </button>
                  </div>
                </div>

                <aside className="border-t border-slate-200 bg-slate-950 p-5 text-white lg:border-l lg:border-t-0 sm:p-6" aria-label="Role requirements preview">
                  <div className="flex items-center gap-2 text-emerald-300"><Target size={17} aria-hidden="true" /><p className="text-[10px] font-bold uppercase tracking-[0.16em]">Reads the role</p></div>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight">What your CV will be checked against</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">We score evidence, surface missing keywords, and prepare truthful role-specific materials for your review.</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {job.skills.slice(0, 8).map((skill) => <span key={skill} className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200">{skill}</span>)}
                    {job.skills.length === 0 && <span className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200">Requirements from the job description</span>}
                  </div>
                  <div className="mt-6 rounded-2xl border border-white/15 bg-white/5 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole size={16} className="text-emerald-300" aria-hidden="true" /> Review before anything is used</div>
                    <p className="mt-2 text-xs leading-5 text-slate-400">This step prepares a private preview. It does not contact the employer or submit an application.</p>
                  </div>
                </aside>
              </div>
            </section>
          ) : (
            <>
              <section className="grid overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-card lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="p-5 sm:p-6">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">Step 02 · Role fit</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{application.matchScore}% CV match</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Keywords are scored against the role. Missing terms stay clearly marked and are never assumed.</p>
                  <div className="mt-5">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Evidence found</p>
                    <div className="mt-2 flex flex-wrap gap-2">{application.matchedKeywords.length ? application.matchedKeywords.map((term) => <span key={term} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-900">{term}</span>) : <span className="text-xs text-slate-500">No strong keyword matches yet.</span>}</div>
                  </div>
                  <div className="mt-5 border-t border-slate-200 pt-5">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Missing—not assumed</p>
                    <div className="mt-2 flex flex-wrap gap-2">{application.missingKeywords.length ? application.missingKeywords.map((term) => <span key={term} className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-950">{term}</span>) : <span className="text-xs text-emerald-800">No material gaps detected.</span>}</div>
                  </div>
                </div>
                <div className="bg-slate-950 p-5 text-white sm:p-6">
                  <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">You approve every edit</p><ShieldCheck size={19} className="text-emerald-300" aria-hidden="true" /></div>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight">No silent rewriting</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">Open CV Studio to review the role score, missing keywords and each suggested edit side by side. Only confirmed experience can be added.</p>
                  <div className="mt-5 rounded-2xl border border-white/15 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3 text-xs"><span className="text-slate-400">Source version</span><span className="font-semibold text-white">{application.resumeVersionLabel}</span></div>
                    <div className="my-3 h-px bg-white/10" />
                    <div className="flex items-center justify-between gap-3 text-xs"><span className="text-slate-400">Truth controls</span><span className="font-semibold text-emerald-300">Required</span></div>
                  </div>
                  <Link href={`/jobs/${job.id}/resume`} className="ir35-focus mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-bold text-emerald-950 transition-colors hover:bg-emerald-300"><WandSparkles size={15} /> Review in CV Studio</Link>
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card sm:p-6">
                <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><FileCheck2 size={19} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-700">Application material</p><h2 className="font-semibold">2. Review the cover letter</h2></div></div>
                <p className="mt-3 text-sm leading-6 text-slate-600">Generated only from job details and evidence already in the CV. Edit the wording before approval.</p>
                <textarea value={application.coverLetter} onChange={(event) => updateApplication((current) => ({ ...current, coverLetter: event.target.value }))} rows={10} aria-label="Role-specific cover letter" className="ir35-focus mt-4 w-full resize-y rounded-2xl border border-slate-300 bg-[#f7f7f5] p-4 text-sm leading-6 text-slate-800" />
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card sm:p-6">
                <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><ClipboardCheck size={19} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700">Step 03 · Answers</p><h2 className="font-semibold">3. Review screening answers</h2></div></div>
                <p className="mt-3 text-sm leading-6 text-slate-600">Each answer shows its source and remains unapproved until you check it.</p>
                <div className="mt-5 grid gap-3">
                  {application.questions.map((question) => (
                    <div key={question.id} className={`rounded-2xl border p-4 ${question.reviewed ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={`question-${question.id}`} className="text-sm font-semibold text-slate-900">{question.label}</label><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">Source: {question.source}</span></div>
                      <input id={`question-${question.id}`} value={question.answer} onChange={(event) => updateApplication((current) => ({ ...current, questions: current.questions.map((item) => item.id === question.id ? { ...item, answer: event.target.value, reviewed: false } : item) }))} className="ir35-focus mt-3 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" />
                      <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={question.reviewed} onChange={(event) => updateApplication((current) => ({ ...current, questions: current.questions.map((item) => item.id === question.id ? { ...item, reviewed: event.target.checked } : item) }))} className="h-5 w-5 rounded border-slate-300 accent-emerald-700" /> I confirm this answer is accurate</label>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-800 bg-slate-950 p-5 text-white shadow-floating sm:p-6">
                <div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-emerald-300"><ShieldCheck size={20} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Step 04 · Approval</p><h2 className="font-semibold">4. Final approval</h2></div></div><span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-300">Nothing sent</span></div>
                <p className="mt-3 text-sm leading-6 text-slate-300">Confirm the exact packet below. Approval creates a private receipt only and never contacts the employer.</p>
                <div className="mt-5 grid gap-2">
                  {[
                    ["truthApproved", "I confirm the CV and cover letter contain only truthful information."],
                    ["materialsApproved", "I reviewed the exact materials and screening answers."],
                    ["submissionApproved", "I approve creation of a dry-run handoff receipt."],
                  ].map(([field, label]) => (
                    <label key={field} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm transition-colors ${application[field as keyof ApplicationRecord] ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/15 bg-white/5"}`}><input type="checkbox" checked={Boolean(application[field as keyof ApplicationRecord])} onChange={(event) => updateApplication((current) => ({ ...current, [field]: event.target.checked }))} className="h-5 w-5 accent-emerald-400" /> {label}</label>
                  ))}
                </div>
                <button type="button" onClick={createReceipt} disabled={busy !== null || Boolean(application.receipt)} className="ir35-focus mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 text-sm font-bold text-emerald-950 transition-colors hover:bg-emerald-300 disabled:opacity-50">
                  {busy === "receipt" ? <Loader2 className="animate-spin" size={17} /> : application.receipt ? <Check size={17} /> : <Send size={17} />} {application.receipt ? "Receipt created" : "Approve dry run"}
                </button>
              </section>

              {application.receipt && reviewedSnapshot && (
                <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card sm:p-6" data-testid="application-receipt-review">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ReceiptText size={19} /></span>
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Receipt · reviewed snapshot</p><h2 className="mt-0.5 font-semibold text-slate-950">5. Inspect the reviewed packet</h2><p className="mt-1 text-sm leading-6 text-slate-600">This immutable snapshot records what you approved for the dry run. It is not an ATS submission confirmation.</p></div>
                  </div>
                  <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-[#f7f7f5] p-4"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-600">CV version</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{reviewedSnapshot.resumeVersionLabel}</dd></div>
                    <div className="rounded-2xl bg-[#f7f7f5] p-4"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Answers reviewed</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{reviewedSnapshot.answers.length}</dd></div>
                    <div className="rounded-2xl bg-[#f7f7f5] p-4"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Destination</dt><dd className="mt-1 truncate text-sm font-semibold text-slate-900">{application.receipt.destination}</dd></div>
                  </dl>
                  <details className="mt-4 rounded-2xl border border-slate-200 bg-[#f7f7f5] p-4">
                    <summary className="ir35-focus cursor-pointer rounded-lg text-sm font-semibold text-brand-800">Review the exact screening answers</summary>
                    <dl className="mt-4 space-y-4">{reviewedSnapshot.answers.map((answer) => <div key={answer.id}><dt className="text-xs font-semibold text-slate-600">{answer.label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{answer.answer}</dd></div>)}</dl>
                  </details>

                  <div className="mt-6 border-t border-slate-200 pt-6">
                    <div className="flex items-start gap-3"><Flag className="mt-0.5 shrink-0 text-brand-700" size={19} /><div><h3 className="font-semibold text-slate-950">Review this receipt</h3><p className="mt-1 text-sm leading-6 text-slate-600">Record anything you would change before preparing another application.</p></div></div>
                    <fieldset className="mt-4"><legend className="sr-only">Receipt review outcome</legend><div className="grid gap-2 sm:grid-cols-2">
                      <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm font-semibold ${reviewOutcome === "accurate" ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-slate-200 text-slate-700"}`}><input type="radio" name="receipt-outcome" value="accurate" checked={reviewOutcome === "accurate"} onChange={() => { setReviewOutcome("accurate"); setReviewFlags([]); }} className="h-5 w-5 accent-emerald-700" />Everything looks accurate</label>
                      <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm font-semibold ${reviewOutcome === "changes_needed" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 text-slate-700"}`}><input type="radio" name="receipt-outcome" value="changes_needed" checked={reviewOutcome === "changes_needed"} onChange={() => setReviewOutcome("changes_needed")} className="h-5 w-5 accent-amber-700" />I would change something</label>
                    </div></fieldset>
                    {reviewOutcome === "changes_needed" && <fieldset className="mt-4"><legend className="text-sm font-semibold text-slate-800">What should change?</legend><div className="mt-2 flex flex-wrap gap-2">{REVIEW_ITEMS.map((item) => <label key={item.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${reviewFlags.includes(item.id) ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-white text-slate-700"}`}><input type="checkbox" checked={reviewFlags.includes(item.id)} onChange={(event) => setReviewFlags((current) => event.target.checked ? [...current, item.id] : current.filter((value) => value !== item.id))} className="h-5 w-5 accent-amber-700" />{item.label}</label>)}</div></fieldset>}
                    <label className="mt-4 block text-sm font-semibold text-slate-800">Notes for next time<textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value.slice(0, 1_200))} rows={4} maxLength={1_200} placeholder="Optional, unless no item is selected" className="ir35-focus mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-[#f7f7f5] p-3 text-sm font-normal leading-6" /></label>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">{reviewNotes.length}/1,200 characters</p><button type="button" onClick={saveReceiptReview} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800"><Check size={16} /> Save receipt review</button></div>
                    {application.receipt.review && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">Saved {new Date(application.receipt.review.savedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.</p>}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:h-max">
          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
            <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Packet readiness</p><h2 className="mt-1 text-sm font-semibold text-slate-950">Preparation checklist</h2></div><strong className="text-2xl tracking-tight text-slate-950">{progress}%</strong></div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} /></div>
            <ul className="mt-5 space-y-3 text-sm">
              {[
                ["CV evidence supplied", cvReady],
                ["Packet prepared", Boolean(application)],
                ["Answers reviewed", answersReviewed],
                ["Approvals complete", approvalsComplete],
                ["Receipt created", Boolean(application?.receipt)],
              ].map(([label, done]) => <li key={String(label)} className="flex items-center gap-2.5">{done ? <CheckCircle2 className="shrink-0 text-emerald-600" size={17} /> : <span className="h-[17px] w-[17px] shrink-0 rounded-full border border-slate-300" />}<span className={done ? "font-medium text-slate-800" : "text-slate-500"}>{label}</span></li>)}
            </ul>
          </section>

          <section className="rounded-[28px] border border-slate-800 bg-slate-950 p-5 text-white">
            <div className="flex items-center gap-2 text-emerald-300"><LockKeyhole size={16} aria-hidden="true" /><p className="text-[10px] font-bold uppercase tracking-[0.16em]">Human approval stays on</p></div>
            <h2 className="mt-3 font-semibold">{application ? application.receipt ? "Packet ready to inspect" : "Review every field" : "Start with your evidence"}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">{application ? application.receipt ? "Your receipt records the exact reviewed packet. The employer has not been contacted." : "Complete the answers and approval checks before a private receipt can be created." : "Paste a CV or load the labelled sample to see role-specific scoring and missing keywords."}</p>
          </section>

          {application?.receipt && (
            <section className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5" data-testid="application-receipt">
              <CheckCircle2 className="text-emerald-700" size={22} />
              <h2 className="mt-3 font-semibold text-emerald-950">Preparation receipt</h2>
              <p className="mt-1 font-mono text-xs text-emerald-800">{application.receipt.receiptId}</p>
              <p className="mt-3 text-sm leading-6 text-emerald-900">{application.receipt.message}</p>
              <Link href="/applications" className="ir35-focus mt-4 inline-flex min-h-11 items-center gap-2 font-semibold text-emerald-900">Open tracker <ExternalLink size={14} /></Link>
            </section>
          )}

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">Manual handoff</p>
            <p className="mt-2 leading-6">Open the original listing and submit it yourself when you are ready. Any future ATS connection will require a separate approval step.</p>
          </section>
        </aside>
      </div>
    </WorkspacePage>
  );
}
