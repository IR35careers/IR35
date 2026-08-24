"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MapPin,
  PencilLine,
  RefreshCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { AppNav } from "@/components/AppNav";
import { ResumeDocumentPreview } from "@/components/resume/ResumeDocumentPreview";
import { StatusPill } from "@/components/workspace/WorkspacePage";
import { formatRate, type JobDetail } from "@/lib/job-types";
import { parseResumeText } from "@/lib/resume/analysis";
import type {
  ApplicationRecord,
  ContractorProfile,
  InboxMessage,
  InboxSettings,
} from "@/lib/workspace/types";

type ApplicationTab = "form" | "resume" | "cover" | "contract";

const TABS: Array<{ id: ApplicationTab; label: string }> = [
  { id: "form", label: "Form" },
  { id: "resume", label: "Resume" },
  { id: "cover", label: "Cover letter" },
  { id: "contract", label: "Contract" },
];

function valueOrFallback(value: string | undefined, fallback = "Not added") {
  return value?.trim() || fallback;
}

function resumeLabel(value: string) {
  return value.replace(/\bCV\b/gi, "Resume");
}

function statusHeading(application: ApplicationRecord) {
  if (application.status === "applied" || application.status === "viewed") return "Application submitted";
  if (application.status === "replied") return "Employer replied";
  if (application.status === "interview") return "Interview stage";
  if (application.status === "offer") return "Offer received";
  if (application.status === "rejected") return "Application closed";
  if (application.status === "withdrawn") return "Application withdrawn";
  if (application.status === "needs_review") return "Review before submitting";
  if (application.status === "failed") return "Ready to retry";
  if (application.status === "ready") return "Ready to apply";
  return "Application in progress";
}

function applicationHasBeenSubmitted(application: ApplicationRecord) {
  return ["applied", "viewed", "replied", "interview", "offer", "rejected"].includes(
    application.status,
  );
}

function statusSummary(application: ApplicationRecord) {
  if (application.attention?.message) return application.attention.message;
  if (application.status === "replied") return "The employer response is linked to this application.";
  if (application.status === "interview") return "Your interview details and employer messages are saved here.";
  if (application.status === "offer") return "Your offer and employer messages are saved here.";
  if (application.status === "rejected") return "This application is closed. Your final Resume remains available.";
  if (applicationHasBeenSubmitted(application)) return "The final Resume and employer confirmation are saved here.";
  return "Your profile, answers and Resume are ready for this contract.";
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
      {label}
      <input
        value={value}
        readOnly
        className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium normal-case tracking-normal text-slate-800"
      />
    </label>
  );
}

export function ApplicationRecordWorkspace({
  job,
  application,
  profile,
  inbox,
  messages,
  busy,
  notice,
  error,
  submitted,
  submissionInProgress,
  answersReviewed,
  approvalsComplete,
  onUpdate,
  onSubmit,
  onRefreshTailoring,
  onResumeBlur,
}: {
  job: JobDetail;
  application: ApplicationRecord;
  profile: ContractorProfile;
  inbox: InboxSettings;
  messages: InboxMessage[];
  busy: "parse" | "prepare" | "ai" | "save" | "submit" | null;
  notice: string | null;
  error: string | null;
  submitted: boolean;
  submissionInProgress: boolean;
  answersReviewed: boolean;
  approvalsComplete: boolean;
  onUpdate: (updater: (current: ApplicationRecord) => ApplicationRecord) => void;
  onSubmit: () => Promise<void>;
  onRefreshTailoring: () => Promise<void>;
  onResumeBlur: () => void;
}) {
  const [tab, setTab] = useState<ApplicationTab>(() =>
    applicationHasBeenSubmitted(application) ? "resume" : "form",
  );
  const [resumeEditing, setResumeEditing] = useState(false);
  const [coverEditing, setCoverEditing] = useState(false);
  const [downloading, setDownloading] = useState<"pdf" | "docx" | null>(null);
  const locked = submitted || applicationHasBeenSubmitted(application) || submissionInProgress;
  const requiredQuestions = application.questions.filter((item) => item.required);
  const optionalQuestions = application.questions.filter((item) => !item.required);
  const receivedEmail = inbox.alias.trim() || profile.email;
  const latestEvents = useMemo(
    () => [...application.events].reverse().slice(0, 5),
    [application.events],
  );
  const linkedMessages = useMemo(
    () =>
      messages
        .filter((message) => message.applicationId === application.id)
        .sort(
          (a, b) =>
            new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
        )
        .slice(0, 3),
    [application.id, messages],
  );
  const contractRate = formatRate(job);
  const parsedResume = useMemo(
    () => parseResumeText(application.tailoredCvText, application.resumeVersionLabel),
    [application.resumeVersionLabel, application.tailoredCvText],
  );
  const resumeOwner =
    parsedResume.candidateName !== "Candidate"
      ? parsedResume.candidateName
      : profile.fullName.trim() || "Your";
  const displayResumeName = `${resumeOwner} Resume`;

  const downloadResume = async (format: "pdf" | "docx") => {
    const parsed = parseResumeText(
      application.tailoredCvText,
      application.resumeVersionLabel,
    );
    setDownloading(format);
    try {
      const response = await fetch("/api/resume/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format,
          resumeText: application.tailoredCvText,
          candidateName: parsed.candidateName,
          jobTitle: job.title,
          companyName: job.company_name,
          versionLabel: resumeLabel(application.resumeVersionLabel),
        }),
      });
      if (!response.ok) throw new Error("Resume export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${parsed.candidateName || "Candidate"}-Resume.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } finally {
      setDownloading(null);
    }
  };

  const updateQuestion = (id: string, answer: string) => {
    onUpdate((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        question.id === id
          ? { ...question, answer, reviewed: answer.trim().length > 0 }
          : question,
      ),
      status: "needs_review",
      submissionApproved: false,
    }));
  };

  const setFinalApproval = (approved: boolean) => {
    onUpdate((current) => ({
      ...current,
      truthApproved: approved,
      materialsApproved: approved,
      submissionApproved: approved,
      status: approved && answersReviewed ? "ready" : "needs_review",
    }));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AppNav />
      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:py-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/applications"
              className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-slate-600 hover:bg-white hover:text-slate-950"
            >
              <ArrowLeft size={15} /> Applications
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {job.title}
              </h1>
              <StatusPill status={application.status} />
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <BriefcaseBusiness size={14} /> {job.company_name}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} /> {job.location}
              </span>
              <span>{job.ir35_status === "unknown" ? "IR35 status to be confirmed" : `${job.ir35_status === "outside" ? "Outside" : "Inside"} IR35`}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">
              {application.matchScore}% match
            </span>
            <a
              href={job.apply_url}
              target="_blank"
              rel="noreferrer"
              className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              View original posting <ExternalLink size={14} />
            </a>
          </div>
        </div>

        <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card">
          <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)]">
            <aside className="border-b border-slate-200 bg-[#fbfaf7] p-5 lg:border-b-0 lg:border-r">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                Application status
              </p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">{statusHeading(application)}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{statusSummary(application)}</p>
              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <Mail className="mt-0.5 shrink-0 text-emerald-700" size={17} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-500">Application email</p>
                  <p className="mt-1 truncate text-[11px] font-medium text-slate-900" title={receivedEmail}>{receivedEmail}</p>
                </div>
              </div>
              <div className="mt-6 hidden border-t border-slate-200 pt-5 lg:block">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Recruiter updates ({linkedMessages.length})</p>
                {linkedMessages.length > 0 ? (
                  <ol className="mt-3 space-y-3">
                    {linkedMessages.map((message) => (
                      <li key={message.id} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.5)]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">{message.classification.replaceAll("_", " ")}</p>
                          <span className="text-[10px] text-slate-400">{new Date(message.receivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                        </div>
                        <p className="mt-2 text-xs font-semibold leading-5 text-slate-900">{message.subject}</p>
                        <p className="mt-1 truncate text-[11px] text-slate-500">{message.from}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500">Employer messages linked to this application will appear here.</p>
                )}
              </div>
              <details className="mt-4 rounded-2xl border border-slate-200 bg-white lg:hidden">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800">
                  Application updates ({linkedMessages.length})
                </summary>
                <div className="border-t border-slate-200 p-4">
                  {linkedMessages.length > 0 ? (
                    <ol className="space-y-3">
                      {linkedMessages.map((message) => (
                        <li key={message.id}>
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">{message.classification.replaceAll("_", " ")}</p>
                          <p className="mt-1 text-xs font-semibold leading-5 text-slate-900">{message.subject}</p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-xs leading-5 text-slate-500">Employer messages will appear here.</p>
                  )}
                  <p className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold leading-5 text-slate-700">{latestEvents[0]?.label || "Application prepared"}</p>
                </div>
              </details>
            </aside>

            <div className="p-5 sm:p-6">
              {application.attention && application.status === "needs_review" && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4" id="needs-attention">
                  <AlertCircle className="mt-0.5 shrink-0 text-amber-700" size={19} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700">Needs you</p>
                    <h2 className="mt-1 font-semibold text-amber-950">{application.attention.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-amber-900">{application.attention.message}</p>
                    {application.attention.questionIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setTab("form")}
                        className="ir35-focus mt-3 min-h-10 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white"
                      >
                        Answer now
                      </button>
                    )}
                    {application.attention.questionIds.length === 0 &&
                      application.attention.action.startsWith("/profile") && (
                        <Link
                          href={application.attention.action}
                          className="ir35-focus mt-3 inline-flex min-h-10 items-center rounded-xl bg-amber-700 px-4 text-sm font-bold text-white"
                        >
                          Complete profile
                        </Link>
                      )}
                  </div>
                </div>
              )}

              {(error || notice) && (
                <p
                  role={error ? "alert" : "status"}
                  className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
                    error
                      ? "border-rose-200 bg-rose-50 text-rose-800"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900"
                  }`}
                >
                  {error ?? notice}
                </p>
              )}

              {submissionInProgress && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950" role="status">
                  <Loader2 className="mt-0.5 shrink-0 animate-spin" size={18} />
                  <div>
                    <p className="font-semibold">Submitting this application</p>
                    <p className="mt-1 leading-6">You can leave this page. The tracker updates when the employer confirms submission or asks for one specific answer.</p>
                  </div>
                </div>
              )}

              <nav className="grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1" aria-label="Application record">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    aria-current={tab === item.id ? "page" : undefined}
                    className={`ir35-focus min-h-11 min-w-0 rounded-xl px-2 text-xs font-semibold sm:px-4 sm:text-sm ${
                      tab === item.id ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>

              {tab === "form" && (
                <div className="mt-6 space-y-7">
                  <section>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="text-emerald-700" size={18} />
                      <h2 className="font-semibold">Personal information</h2>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Filled from your approved contractor profile.</p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="Full name" value={valueOrFallback(profile.fullName)} />
                      <Field label="Email used" value={valueOrFallback(receivedEmail)} />
                      <Field label="Phone" value={valueOrFallback(profile.phone)} />
                      <Field label="Location" value={valueOrFallback(profile.location)} />
                      <Field label="Right to work" value={profile.rightToWork === "yes" ? "Authorised to work in the UK" : profile.rightToWork.replaceAll("_", " ")} />
                      <Field label="Availability" value={valueOrFallback(profile.availability)} />
                    </div>
                  </section>

                  <section className="border-t border-slate-200 pt-6">
                    <div className="flex items-center gap-2">
                      <FileText className="text-emerald-700" size={18} />
                      <h2 className="font-semibold">Attachments</h2>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{displayResumeName}</p>
                        <p className="mt-1 text-xs text-slate-500">Resume selected for this application</p>
                      </div>
                      <button type="button" onClick={() => setTab("resume")} className="ir35-focus min-h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold">Review Resume</button>
                    </div>
                  </section>

                  <section className="border-t border-slate-200 pt-6" id="employer-questions">
                    <h2 className="font-semibold">Employer questions</h2>
                    <p className="mt-1 text-sm text-slate-500">Saved answers are reused. Only new or changed questions need your attention.</p>
                    <div className="mt-4 space-y-3">
                      {[...requiredQuestions, ...optionalQuestions].map((question) => {
                        const highlighted = application.attention?.questionIds.includes(question.id);
                        return (
                          <label
                            key={question.id}
                            className={`block rounded-2xl border p-4 ${highlighted ? "border-amber-400 bg-amber-50 ring-2 ring-amber-100" : "border-slate-200 bg-white"}`}
                          >
                            <span className="flex items-start justify-between gap-3 text-sm font-semibold text-slate-900">
                              {question.label}
                              {question.required && <span className="text-xs text-rose-600">Required</span>}
                            </span>
                            <input
                              value={question.answer}
                              readOnly={locked}
                              onChange={(event) => updateQuestion(question.id, event.target.value)}
                              placeholder="Add your answer"
                              className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm read-only:bg-slate-50"
                            />
                          </label>
                        );
                      })}
                      {application.questions.length === 0 && (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                          No additional employer questions were found for this contract.
                        </div>
                      )}
                    </div>
                  </section>

                  {!submitted && (
                    <section className="border-t border-slate-200 pt-6">
                      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                        <input
                          type="checkbox"
                          checked={approvalsComplete}
                          disabled={submissionInProgress}
                          onChange={(event) => setFinalApproval(event.target.checked)}
                          className="mt-0.5 h-5 w-5 accent-emerald-700"
                        />
                        <span><strong className="block text-slate-950">Approve this application</strong>I confirm the Resume and answers are accurate and authorise IR35Careers to submit them for this contract.</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => void onSubmit()}
                        disabled={busy !== null || submissionInProgress || !answersReviewed || !approvalsComplete}
                        className="ir35-focus mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
                      >
                        {busy === "submit" || submissionInProgress ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                        {submissionInProgress ? "Submitting application" : application.status === "failed" ? "Retry application" : "Submit application"}
                      </button>
                    </section>
                  )}

                  {submitted && application.receipt && (
                    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                      <CheckCircle2 className="text-emerald-700" size={22} />
                      <h2 className="mt-3 font-semibold text-emerald-950">Employer confirmation received</h2>
                      <p className="mt-1 text-sm leading-6 text-emerald-900">{application.receipt.message}</p>
                      <p className="mt-3 text-xs font-semibold text-emerald-800">Receipt {application.receipt.receiptId}</p>
                    </section>
                  )}
                </div>
              )}

              {tab === "resume" && (
                <section className="mt-6 -mx-5 -mb-5 sm:-mx-6 sm:-mb-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 px-5 sm:px-6">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Application Resume</p>
                      <h2 className="mt-1 truncate text-lg font-semibold">{displayResumeName}</h2>
                    </div>
                    <div className="flex flex-wrap gap-2 px-5 sm:px-6">
                      {!locked && (
                        <button type="button" onClick={() => setResumeEditing((current) => !current)} className="ir35-focus inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                          {resumeEditing ? <FileText size={15} /> : <PencilLine size={15} />}
                          {resumeEditing ? "Close editor" : "Edit Resume"}
                        </button>
                      )}
                      {!locked && (
                        <button type="button" onClick={() => void onRefreshTailoring()} disabled={busy !== null} className="ir35-focus inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                          {busy === "ai" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={15} />} Improve Resume
                        </button>
                      )}
                      <button type="button" onClick={() => void downloadResume("pdf")} disabled={downloading !== null} className="ir35-focus inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">
                        {downloading === "pdf" ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />} Download PDF
                      </button>
                    </div>
                  </div>
                  <details className="mx-5 mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm sm:mx-6">
                    <summary className="cursor-pointer font-semibold text-slate-700">Match details: {application.matchScore}%</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div><p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Evidence found</p><p className="mt-1 text-sm leading-6 text-slate-700">{application.matchedKeywords.join(", ") || "No strong keyword matches yet."}</p></div>
                      <div><p className="text-xs font-bold uppercase tracking-wide text-amber-800">Missing from your evidence</p><p className="mt-1 text-sm leading-6 text-slate-700">{application.missingKeywords.join(", ") || "No material gaps found."}</p></div>
                    </div>
                  </details>
                  {resumeEditing && !locked ? (
                    <div className="mt-4 grid gap-4 bg-slate-100 px-3 py-5 sm:px-6 sm:py-8 xl:grid-cols-[minmax(340px,0.75fr)_minmax(0,1.25fr)]">
                      <section className="self-start rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <div className="mb-3">
                          <p className="text-sm font-semibold text-slate-950">Edit Resume text</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">Changes appear in the document preview. Your approval is reset after an edit.</p>
                        </div>
                        <textarea aria-label="Resume text" value={application.tailoredCvText} onChange={(event) => onUpdate((current) => ({ ...current, tailoredCvText: event.target.value, truthApproved: false, materialsApproved: false, submissionApproved: false, status: "needs_review" }))} onBlur={onResumeBlur} rows={30} className="ir35-focus w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-4 font-mono text-[13px] leading-6 text-slate-800" />
                      </section>
                      <div className="hidden xl:block">
                        <ResumeDocumentPreview resumeText={application.tailoredCvText} filename={resumeLabel(application.resumeVersionLabel)} candidateName={profile.fullName} />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 overflow-auto bg-slate-100 px-3 py-5 sm:px-8 sm:py-10">
                      <ResumeDocumentPreview resumeText={application.tailoredCvText} filename={resumeLabel(application.resumeVersionLabel)} candidateName={profile.fullName} />
                    </div>
                  )}
                </section>
              )}

              {tab === "cover" && (
                <section className="mt-6 -mx-5 -mb-5 sm:-mx-6 sm:-mb-6">
                  <div className="flex flex-col gap-3 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Application letter</p>
                      <h2 className="mt-1 text-lg font-semibold">Cover letter</h2>
                    </div>
                    {!locked && (
                      <button type="button" onClick={() => setCoverEditing((current) => !current)} className="ir35-focus inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:self-auto">
                        {coverEditing ? <FileText size={15} /> : <PencilLine size={15} />}
                        {coverEditing ? "Close editor" : "Edit letter"}
                      </button>
                    )}
                  </div>
                  <div className="mt-4 bg-slate-100 p-5 sm:p-8">
                    {coverEditing && !locked ? (
                      <div className="mx-auto grid max-w-[1180px] gap-5 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
                        <section className="self-start rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                          <p className="text-sm font-semibold text-slate-950">Edit cover letter</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">Your changes appear in the letter preview and reset final approval.</p>
                          <textarea aria-label="Cover letter" value={application.coverLetter} onChange={(event) => onUpdate((current) => ({ ...current, coverLetter: event.target.value, materialsApproved: false, submissionApproved: false, status: "needs_review" }))} rows={24} className="ir35-focus mt-4 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm leading-7" />
                        </section>
                        <article className="min-h-[760px] whitespace-pre-wrap bg-white px-8 py-10 text-sm leading-7 text-slate-800 shadow-[0_18px_55px_rgba(15,23,42,0.12)] sm:px-14 sm:py-12">{application.coverLetter}</article>
                      </div>
                    ) : (
                      <article className="mx-auto min-h-[760px] max-w-[780px] whitespace-pre-wrap bg-white px-8 py-10 text-sm leading-7 text-slate-800 shadow-[0_18px_55px_rgba(15,23,42,0.12)] sm:px-14 sm:py-12">{application.coverLetter}</article>
                    )}
                  </div>
                </section>
              )}

              {tab === "contract" && (
                <section className="mt-6">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Rate</p><p className="mt-2 font-semibold">{contractRate}</p></div>
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Working pattern</p><p className="mt-2 font-semibold capitalize">{job.remote_type}</p></div>
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">IR35</p><p className="mt-2 font-semibold capitalize">{job.ir35_status === "unknown" ? "To be confirmed" : job.ir35_status}</p></div>
                  </div>
                  <h2 className="mt-6 text-xl font-semibold">Contract description</h2>
                  <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-7 text-slate-700">{job.description || "The full contract description is available from the original posting."}</div>
                </section>
              )}
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
          <div className="flex items-center gap-2">
            <Clock3 className="text-slate-500" size={18} />
            <h2 className="font-semibold">Application history</h2>
          </div>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {latestEvents.map((event) => (
              <li key={event.id} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">{event.label}</p>
                <p className="mt-1 text-xs text-slate-500">{new Date(event.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
