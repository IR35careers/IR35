"use client";

import Link from "next/link";
import { Check, ChevronRight, Circle } from "lucide-react";
import type { ApplicationRecord } from "@/lib/workspace/types";

const FINISHED = new Set<ApplicationRecord["status"]>(["applied", "viewed", "replied", "interview", "offer"]);

export function ApplicationJourney({ profileReady, applications }: { profileReady: boolean; applications: ApplicationRecord[] }) {
  const current = applications.find((item) => !["rejected", "withdrawn", "failed", "skipped"].includes(item.status)) ?? applications[0] ?? null;
  const prepared = Boolean(current);
  const approved = Boolean(current?.truthApproved && current.materialsApproved && current.submissionApproved);
  const submitted = Boolean(current && FINISHED.has(current.status));
  const tracked = Boolean(current && ["viewed", "replied", "interview", "offer"].includes(current.status));
  const steps = [
    { label: "Complete profile", shortLabel: "Profile", done: profileReady },
    { label: "Choose a role", shortLabel: "Find", done: prepared },
    { label: "Prepare and apply", shortLabel: "Apply", done: submitted },
    { label: "Follow updates", shortLabel: "Track", done: tracked },
  ];
  const firstIncompleteIndex = steps.findIndex((item) => !item.done);
  const activeIndex = firstIncompleteIndex === -1 ? steps.length - 1 : firstIncompleteIndex;
  const next = !profileReady
    ? { title: "Complete your profile", body: "Add your Resume and a few details so we can find contracts that suit you.", href: "/profile", action: "Complete profile" }
    : !prepared
      ? { title: "Choose a contract", body: "Open a role to see the important details and begin your application.", href: "/jobs", action: "Find contracts" }
      : !approved
        ? { title: `Review ${current?.job.title ?? "your application"}`, body: "Check your Resume and answers before you apply.", href: `/applications/new/${current?.job.id}`, action: "Continue review" }
        : !submitted
          ? { title: "Ready to apply", body: "Review once, then submit. We will ask only if something is missing.", href: `/applications/new/${current?.job.id}`, action: "Open application" }
          : { title: "Track your application", body: "See confirmations, recruiter messages and interviews in one place.", href: "/applications", action: "Open tracker" };

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_35px_-26px_rgba(15,23,42,0.32)]" aria-labelledby="journey-title" data-tour="application-journey">
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-bold text-brand-800" aria-hidden="true">
            {String(activeIndex + 1).padStart(2, "0")}
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-brand-700">Next step</p>
            <h2 id="journey-title" className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950">{next.title}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{next.body}</p>
          </div>
        </div>
        <Link href={next.href} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition-colors hover:bg-brand-800">
          {next.action} <ChevronRight size={15} aria-hidden="true" />
        </Link>
      </div>
      <ol className="grid grid-cols-2 border-t border-slate-200 bg-slate-50/70 sm:grid-cols-4" aria-label="Application journey">
        {steps.map((step, index) => {
          const active = index === activeIndex && !step.done;
          return (
            <li key={step.label} aria-current={active ? "step" : undefined} className={`relative flex min-h-[62px] items-center gap-3 px-4 py-3 sm:border-r sm:last:border-r-0 ${active ? "bg-white text-brand-900" : step.done ? "text-slate-800" : "text-slate-400"}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${step.done ? "bg-brand-700 text-white" : active ? "border-2 border-brand-700 bg-white text-brand-800" : "border border-slate-200 bg-white"}`}>
                {step.done ? <Check size={14} aria-hidden="true" /> : active ? index + 1 : <Circle size={11} aria-hidden="true" />}
              </span>
              <span><span className="block text-xs font-semibold sm:hidden">{step.shortLabel}</span><span className="hidden text-xs font-semibold sm:block">{step.label}</span></span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
