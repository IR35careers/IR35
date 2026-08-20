"use client";

import Link from "next/link";
import { ArrowRight, Check, Circle } from "lucide-react";
import type { ApplicationRecord } from "@/lib/workspace/types";

const FINISHED = new Set<ApplicationRecord["status"]>(["applied", "viewed", "replied", "interview", "offer"]);

export function ApplicationJourney({ profileReady, applications }: { profileReady: boolean; applications: ApplicationRecord[] }) {
  const current = applications.find((item) => !["rejected", "withdrawn", "failed", "skipped"].includes(item.status)) ?? applications[0] ?? null;
  const prepared = Boolean(current);
  const approved = Boolean(current?.truthApproved && current.materialsApproved && current.submissionApproved);
  const submitted = Boolean(current && FINISHED.has(current.status));
  const tracked = Boolean(current && ["viewed", "replied", "interview", "offer"].includes(current.status));
  const steps = [
    { label: "Profile", done: profileReady },
    { label: "Find", done: prepared },
    { label: "Prepare", done: prepared },
    { label: "Approve", done: approved },
    { label: "Submit", done: submitted },
    { label: "Track", done: tracked },
  ];
  const activeIndex = Math.max(0, steps.findIndex((item) => !item.done));
  const next = !profileReady
    ? { title: "Complete your evidence profile", body: "Add skills and a CV so match scores and suggested edits use your real experience.", href: "/profile", action: "Complete profile" }
    : !prepared
      ? { title: "Choose a contract to prepare", body: "Open a matching role, inspect the IR35 evidence, then start a role-specific application.", href: "/jobs", action: "Find contracts" }
      : !approved
        ? { title: `Review ${current?.job.title ?? "your application"}`, body: "Check the tailored CV, missing keywords, cover letter and screening answers before approval.", href: `/applications/new/${current?.job.id}`, action: "Continue review" }
        : !submitted
          ? { title: "Your approved packet is ready", body: "Apply from IR35Careers when the employer connection is verified. Otherwise the packet remains safely queued here.", href: `/applications/new/${current?.job.id}`, action: "Open approved packet" }
          : { title: "Track the employer response", body: "Keep recruiter messages, interviews and next actions tied to the application.", href: "/applications", action: "Open applications" };

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card" aria-labelledby="journey-title" data-tour="application-journey">
      <div className="grid gap-5 bg-slate-950 p-5 text-white sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-emerald-300">Your next best action</p>
          <h2 id="journey-title" className="mt-2 text-xl font-semibold tracking-tight">{next.title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">{next.body}</p>
        </div>
        <Link href={next.href} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-bold text-emerald-950 transition-colors hover:bg-emerald-300">
          {next.action} <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
      <ol className="grid grid-cols-3 gap-px bg-slate-200 sm:grid-cols-6" aria-label="Application journey">
        {steps.map((step, index) => {
          const active = index === activeIndex && !step.done;
          return (
            <li key={step.label} aria-current={active ? "step" : undefined} className={`flex min-h-20 items-center gap-2 bg-white px-3 py-4 ${active ? "text-brand-900" : step.done ? "text-slate-800" : "text-slate-400"}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${step.done ? "bg-brand-600 text-white" : active ? "border-2 border-brand-600 bg-brand-50 text-brand-800" : "border border-slate-200 bg-slate-50"}`}>
                {step.done ? <Check size={14} aria-hidden="true" /> : active ? index + 1 : <Circle size={11} aria-hidden="true" />}
              </span>
              <span className="text-xs font-semibold">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
