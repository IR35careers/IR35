import type { ReactNode } from "react";
import { AlertCircle, Inbox } from "lucide-react";

export function StatePanel({
  kind = "empty",
  title,
  body,
  action,
}: {
  kind?: "empty" | "error";
  title: string;
  body: string;
  action?: ReactNode;
}) {
  const Icon = kind === "error" ? AlertCircle : Inbox;
  return (
    <div
      className={`rounded-2xl border p-8 text-center ${
        kind === "error" ? "border-red-200 bg-red-50/70" : "border-slate-200 bg-white"
      }`}
      role={kind === "error" ? "alert" : undefined}
    >
      <span
        className={`mx-auto flex h-11 w-11 items-center justify-center rounded-xl ${
          kind === "error" ? "bg-red-100 text-red-700" : "bg-brand-50 text-brand-700"
        }`}
      >
        <Icon size={20} aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-slate-950">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-600">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function JobCardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`animate-pulse rounded-2xl border border-slate-200 bg-white ${compact ? "p-4" : "p-5"}`} aria-hidden="true">
      <div className="h-3 w-24 rounded-full bg-slate-200" />
      <div className="mt-4 h-5 w-3/4 rounded bg-slate-200" />
      <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
      <div className="mt-5 flex gap-2">
        <div className="h-7 w-24 rounded-full bg-slate-100" />
        <div className="h-7 w-20 rounded-full bg-slate-100" />
      </div>
    </div>
  );
}

