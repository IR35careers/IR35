"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FileText,
  Flag,
  Loader2,
  ReceiptText,
  Send,
  ShieldCheck,
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
      eyebrow="Application workspace"
      title={`Prepare for ${job.company_name}`}
      description="Review exactly what will be used for this role. IR35Careers never invents experience and never submits from this preview."
      actions={<Link href={`/jobs/${job.id}`} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-slate-400"><ArrowLeft size={15} /> Role details</Link>}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-brand-700">{job.ir35_status === "unknown" ? "IR35 status needs confirmation" : `${job.ir35_status} IR35`}</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">{job.title}</h2>
                <p className="mt-1 text-sm text-slate-600">{job.location} · {job.remote_type} · {job.skills.join(" · ")}</p>
              </div>
              {application && <StatusPill status={application.status} />}
            </div>
          </section>

          {!application ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><FileText size={20} /></span>
                <div><h2 className="font-semibold">1. Choose the CV evidence</h2><p className="text-sm text-slate-600">Paste CV text or load the fictional labelled sample.</p></div>
              </div>
              <textarea
                value={cvText}
                onChange={(event) => setCvText(event.target.value)}
                rows={14}
                aria-label="CV text for this application"
                placeholder="Paste your CV text here…"
                className="ir35-focus mt-5 w-full resize-y rounded-2xl border border-slate-300 bg-slate-50 p-4 font-mono text-sm leading-6 text-slate-800"
              />
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => { setCvText(SAMPLE_CV_TEXT); setNotice("Fictional sample CV loaded for local testing."); }} className="ir35-focus min-h-11 text-left text-sm font-semibold text-brand-700 hover:text-brand-800">Load labelled sample CV</button>
                <button type="button" onClick={prepare} disabled={busy !== null || cvText.trim().length < 120} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {busy === "prepare" ? <Loader2 className="animate-spin" size={17} /> : <WandSparkles size={17} />} Prepare application
                </button>
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><p className="text-xs font-bold uppercase tracking-wide text-brand-700">Role-specific evidence</p><h2 className="mt-1 text-xl font-semibold">{application.matchScore}% CV match</h2></div>
                  <Link href={`/jobs/${job.id}/resume`} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-800"><WandSparkles size={15} /> Open CV Studio</Link>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-semibold text-emerald-900">Evidence found</p><div className="mt-2 flex flex-wrap gap-1.5">{application.matchedKeywords.map((term) => <span key={term} className="rounded-full bg-white px-2.5 py-1 text-xs text-emerald-800">{term}</span>)}</div></div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-950">Missing—not assumed</p><div className="mt-2 flex flex-wrap gap-1.5">{application.missingKeywords.length ? application.missingKeywords.map((term) => <span key={term} className="rounded-full bg-white px-2.5 py-1 text-xs text-amber-900">{term}</span>) : <span className="text-xs text-amber-900">No material gaps detected.</span>}</div></div>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
                <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><FileCheck2 size={20} /></span><div><h2 className="font-semibold">2. Review the cover letter</h2><p className="text-sm text-slate-600">Generated only from job details and evidence already in the CV.</p></div></div>
                <textarea value={application.coverLetter} onChange={(event) => updateApplication((current) => ({ ...current, coverLetter: event.target.value }))} rows={13} aria-label="Role-specific cover letter" className="ir35-focus mt-5 w-full resize-y rounded-2xl border border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-800" />
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
                <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><ClipboardCheck size={20} /></span><div><h2 className="font-semibold">3. Review screening answers</h2><p className="text-sm text-slate-600">Every required answer must be explicitly checked.</p></div></div>
                <div className="mt-5 space-y-4">
                  {application.questions.map((question) => (
                    <div key={question.id} className="rounded-2xl border border-slate-200 p-4">
                      <label htmlFor={`question-${question.id}`} className="text-sm font-semibold text-slate-900">{question.label}</label>
                      <input id={`question-${question.id}`} value={question.answer} onChange={(event) => updateApplication((current) => ({ ...current, questions: current.questions.map((item) => item.id === question.id ? { ...item, answer: event.target.value, reviewed: false } : item) }))} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" />
                      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={question.reviewed} onChange={(event) => updateApplication((current) => ({ ...current, questions: current.questions.map((item) => item.id === question.id ? { ...item, reviewed: event.target.checked } : item) }))} className="h-5 w-5 rounded border-slate-300 accent-emerald-700" /> I confirm this answer is accurate</label>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white shadow-card sm:p-6">
                <div className="flex items-center gap-3"><ShieldCheck className="text-emerald-300" size={22} /><div><h2 className="font-semibold">4. Final approval</h2><p className="text-sm text-slate-300">This creates a receipt only. It does not contact the employer.</p></div></div>
                <div className="mt-5 space-y-2">
                  {[
                    ["truthApproved", "I confirm the CV and cover letter contain only truthful information."],
                    ["materialsApproved", "I reviewed the exact materials and screening answers."],
                    ["submissionApproved", "I approve creation of a dry-run handoff receipt."],
                  ].map(([field, label]) => (
                    <label key={field} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4 text-sm"><input type="checkbox" checked={Boolean(application[field as keyof ApplicationRecord])} onChange={(event) => updateApplication((current) => ({ ...current, [field]: event.target.checked }))} className="h-5 w-5 accent-emerald-400" /> {label}</label>
                  ))}
                </div>
                <button type="button" onClick={createReceipt} disabled={busy !== null || Boolean(application.receipt)} className="ir35-focus mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 text-sm font-bold text-emerald-950 hover:bg-emerald-300 disabled:opacity-50">
                  {busy === "receipt" ? <Loader2 className="animate-spin" size={17} /> : application.receipt ? <Check size={17} /> : <Send size={17} />} {application.receipt ? "Receipt created" : "Approve dry run"}
                </button>
              </section>

              {application.receipt && reviewedSnapshot && (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" data-testid="application-receipt-review">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><ReceiptText size={20} /></span>
                    <div><h2 className="font-semibold text-slate-950">5. Inspect the reviewed packet</h2><p className="mt-1 text-sm leading-6 text-slate-600">This immutable snapshot records what you approved for the dry run. It is not an ATS submission confirmation.</p></div>
                  </div>
                  <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">CV version</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{reviewedSnapshot.resumeVersionLabel}</dd></div>
                    <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Answers reviewed</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{reviewedSnapshot.answers.length}</dd></div>
                    <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Destination</dt><dd className="mt-1 truncate text-sm font-semibold text-slate-900">{application.receipt.destination}</dd></div>
                  </dl>
                  <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <summary className="ir35-focus cursor-pointer rounded-lg text-sm font-semibold text-brand-800">Review the exact screening answers</summary>
                    <dl className="mt-4 space-y-4">
                      {reviewedSnapshot.answers.map((answer) => <div key={answer.id}><dt className="text-xs font-semibold text-slate-600">{answer.label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{answer.answer}</dd></div>)}
                    </dl>
                  </details>

                  <div className="mt-6 border-t border-slate-200 pt-6">
                    <div className="flex items-start gap-3"><Flag className="mt-0.5 shrink-0 text-brand-700" size={19} /><div><h3 className="font-semibold text-slate-950">Review this receipt</h3><p className="mt-1 text-sm leading-6 text-slate-600">Record anything you would change before preparing another application.</p></div></div>
                    <fieldset className="mt-4">
                      <legend className="sr-only">Receipt review outcome</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm font-semibold ${reviewOutcome === "accurate" ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-slate-200 text-slate-700"}`}><input type="radio" name="receipt-outcome" value="accurate" checked={reviewOutcome === "accurate"} onChange={() => { setReviewOutcome("accurate"); setReviewFlags([]); }} className="h-5 w-5 accent-emerald-700" />Everything looks accurate</label>
                        <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm font-semibold ${reviewOutcome === "changes_needed" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 text-slate-700"}`}><input type="radio" name="receipt-outcome" value="changes_needed" checked={reviewOutcome === "changes_needed"} onChange={() => setReviewOutcome("changes_needed")} className="h-5 w-5 accent-amber-700" />I would change something</label>
                      </div>
                    </fieldset>
                    {reviewOutcome === "changes_needed" && <fieldset className="mt-4"><legend className="text-sm font-semibold text-slate-800">What should change?</legend><div className="mt-2 flex flex-wrap gap-2">{REVIEW_ITEMS.map((item) => <label key={item.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${reviewFlags.includes(item.id) ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-white text-slate-700"}`}><input type="checkbox" checked={reviewFlags.includes(item.id)} onChange={(event) => setReviewFlags((current) => event.target.checked ? [...current, item.id] : current.filter((value) => value !== item.id))} className="h-5 w-5 accent-amber-700" />{item.label}</label>)}</div></fieldset>}
                    <label className="mt-4 block text-sm font-semibold text-slate-800">Notes for next time<textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value.slice(0, 1_200))} rows={4} maxLength={1_200} placeholder="Optional, unless no item is selected" className="ir35-focus mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-slate-50 p-3 text-sm font-normal leading-6" /></label>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">{reviewNotes.length}/1,200 characters</p><button type="button" onClick={saveReceiptReview} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800"><Check size={16} /> Save receipt review</button></div>
                    {application.receipt.review && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">Saved {new Date(application.receipt.review.savedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.</p>}
                  </div>
                </section>
              )}
            </>
          )}

          {(error || notice) && <p role={error ? "alert" : "status"} className={`rounded-2xl border px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error ?? notice}</p>}
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-max">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-semibold text-slate-950">Preparation checklist</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {[
                ["CV evidence supplied", cvText.trim().length >= 120],
                ["Packet prepared", Boolean(application)],
                ["Answers reviewed", Boolean(application?.questions.every((item) => !item.required || item.reviewed))],
                ["Approvals complete", Boolean(application?.truthApproved && application.materialsApproved && application.submissionApproved)],
                ["Receipt created", Boolean(application?.receipt)],
              ].map(([label, done]) => <li key={String(label)} className="flex items-center gap-2">{done ? <CheckCircle2 className="text-emerald-600" size={17} /> : <span className="h-4 w-4 rounded-full border border-slate-300" />}<span className={done ? "text-slate-800" : "text-slate-500"}>{label}</span></li>)}
            </ul>
          </section>
          {application?.receipt && (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5" data-testid="application-receipt">
              <CheckCircle2 className="text-emerald-700" size={22} />
              <h2 className="mt-3 font-semibold text-emerald-950">Preparation receipt</h2>
              <p className="mt-1 font-mono text-xs text-emerald-800">{application.receipt.receiptId}</p>
              <p className="mt-3 text-sm leading-6 text-emerald-900">{application.receipt.message}</p>
              <Link href="/applications" className="ir35-focus mt-4 inline-flex min-h-11 items-center gap-2 font-semibold text-emerald-900">Open tracker <ExternalLink size={14} /></Link>
            </section>
          )}
          <section className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">Live handoff</p>
            <p className="mt-2 leading-6">When you are ready, open the original listing and submit manually. A supported ATS provider can be added later behind another approval step.</p>
          </section>
        </aside>
      </div>
    </WorkspacePage>
  );
}
