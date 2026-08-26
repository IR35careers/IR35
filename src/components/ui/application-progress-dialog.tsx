"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  FileCheck2,
  Loader2,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { Brand } from "@/components/ui/brand";
import type { ApplicationProgressPhase } from "@/lib/application-progress";

const STEPS = [
  { label: "Application ready", icon: FileCheck2 },
  { label: "Employer form", icon: Send },
  { label: "Confirmation", icon: CheckCircle2 },
] as const;

const PHASE_CONTENT: Record<
  ApplicationProgressPhase,
  {
    eyebrow: string;
    title: string;
    description: string;
    activeStep: number;
    progress: number;
  }
> = {
  preparing: {
    eyebrow: "Preparing your application",
    title: "Getting everything ready",
    description:
      "We are checking your approved Resume, profile and answers before opening the employer form.",
    activeStep: 0,
    progress: 20,
  },
  applying: {
    eyebrow: "Application in progress",
    title: "Completing the employer form",
    description:
      "IR35Careers is filling the employer form and waiting for a confirmed result. You can close this window while it continues.",
    activeStep: 1,
    progress: 68,
  },
  success: {
    eyebrow: "Application complete",
    title: "Your application was submitted",
    description:
      "The employer confirmation has been received and saved in your tracker.",
    activeStep: 3,
    progress: 100,
  },
  attention: {
    eyebrow: "One step needs you",
    title: "Your application is safely paused",
    description:
      "Everything completed so far is saved. Review the highlighted item and we will continue from there.",
    activeStep: 1,
    progress: 68,
  },
  error: {
    eyebrow: "Application paused",
    title: "We could not confirm submission",
    description:
      "Your approved application is still saved. Try again without rebuilding your Resume or answers.",
    activeStep: 1,
    progress: 68,
  },
};

export function ApplicationProgressDialog({
  open,
  phase,
  roleTitle,
  companyName,
  elapsedSeconds,
  message,
  onClose,
  onReview,
  onRetry,
}: {
  open: boolean;
  phase: ApplicationProgressPhase;
  roleTitle: string;
  companyName: string;
  elapsedSeconds: number;
  message?: string | null;
  onClose: () => void;
  onReview: () => void;
  onRetry: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const content = PHASE_CONTENT[phase];
  const isWorking = phase === "preparing" || phase === "applying";
  const closeDialog = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="application-progress-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="relative w-full overflow-hidden rounded-t-[2rem] border border-white/10 bg-white shadow-2xl sm:max-w-2xl sm:rounded-[2rem]">
        <header className="relative overflow-hidden bg-slate-950 px-5 pb-7 pt-5 text-white sm:px-7 sm:pb-8 sm:pt-6">
          <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <Brand href="/dashboard" tone="dark" />
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="ir35-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white transition hover:bg-white/15"
              aria-label={isWorking ? "Hide application progress" : "Close application progress"}
            >
              <X size={19} />
            </button>
          </div>

          <div className="relative mt-8 flex items-start gap-4">
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                phase === "success"
                  ? "bg-emerald-400 text-slate-950"
                  : phase === "attention" || phase === "error"
                    ? "bg-amber-300 text-slate-950"
                    : "bg-emerald-400/15 text-emerald-300"
              }`}
              aria-hidden="true"
            >
              {phase === "success" ? (
                <CheckCircle2 size={25} />
              ) : phase === "attention" || phase === "error" ? (
                <AlertCircle size={25} />
              ) : (
                <Loader2 className="animate-spin" size={25} />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                {content.eyebrow}
              </p>
              <h2
                id="application-progress-title"
                className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                {content.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {roleTitle} at {companyName}
              </p>
            </div>
          </div>
        </header>

        <div className="px-5 py-6 sm:px-7 sm:py-7">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div
              className={`h-full rounded-full transition-[width] duration-700 ${
                phase === "attention" || phase === "error" ? "bg-amber-500" : "bg-emerald-600"
              }`}
              style={{ width: `${content.progress}%` }}
            />
          </div>

          <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Application submission progress">
            {STEPS.map((step, index) => {
              const complete = content.activeStep > index;
              const current = content.activeStep === index;
              const StepIcon = step.icon;
              return (
                <li key={step.label} className="min-w-0 text-center">
                  <span
                    className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full border transition ${
                      complete
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : current
                          ? phase === "attention" || phase === "error"
                            ? "border-amber-400 bg-amber-50 text-amber-700"
                            : "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-400"
                    }`}
                  >
                    {complete ? <Check size={16} /> : <StepIcon size={16} />}
                  </span>
                  <span className={`mt-2 block truncate text-[11px] font-semibold sm:text-xs ${complete || current ? "text-slate-900" : "text-slate-400"}`}>
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>

          <div
            className={`mt-6 rounded-2xl border p-4 ${
              phase === "success"
                ? "border-emerald-200 bg-emerald-50"
                : phase === "attention" || phase === "error"
                  ? "border-amber-200 bg-amber-50"
                  : "border-slate-200 bg-slate-50"
            }`}
            aria-live="polite"
          >
            <p className="text-sm leading-6 text-slate-700">{message || content.description}</p>
            {isWorking && (
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Running for {elapsedSeconds}s. You can safely continue using IR35Careers.
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {phase === "error" && (
              <button
                type="button"
                onClick={onClose}
                className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            )}
            {phase === "attention" ? (
              <button
                type="button"
                onClick={onReview}
                className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 text-sm font-bold text-white hover:bg-amber-700"
              >
                Review what is needed
              </button>
            ) : phase === "error" ? (
              <button
                type="button"
                onClick={onRetry}
                className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white hover:bg-slate-800"
              >
                <RotateCcw size={16} /> Try again
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-bold text-white hover:bg-emerald-800"
              >
                {phase === "success" ? "Done" : "Hide and continue"}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
