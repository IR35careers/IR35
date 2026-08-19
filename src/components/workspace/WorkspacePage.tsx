"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, FlaskConical, Loader2 } from "lucide-react";
import { AppNav } from "@/components/AppNav";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceCloudSync } from "@/lib/workspace/store";

export function WorkspacePage({
  title,
  description,
  eyebrow,
  actions,
  children,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const configured = isSupabaseConfigured();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const cloud = useWorkspaceCloudSync(configured ? user?.id ?? null : null, user?.email ?? "");

  useEffect(() => {
    if (configured && !authLoading && !user) router.replace(`/account?next=${encodeURIComponent(window.location.pathname)}`);
  }, [authLoading, configured, router, user]);

  if (configured && (authLoading || !user || cloud.loading)) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500" aria-busy="true"><Loader2 className="animate-spin" size={22} /><span className="sr-only">Loading your private workspace</span></main>;
  }

  if (configured && cloud.error) {
    return <div className="min-h-screen bg-slate-50"><AppNav /><main className="mx-auto max-w-2xl px-4 py-16 sm:px-6"><div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-950" role="alert"><CloudOff size={24} /><h1 className="mt-4 text-xl font-semibold">Your private workspace could not be loaded</h1><p className="mt-2 text-sm leading-6">{cloud.error}</p><p className="mt-3 text-sm leading-6">Apply migration 010 and retry before using sensitive production data. The workspace fails closed, so local fixtures are not shown here.</p></div></main></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AppNav />
      <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:py-9">
        {!configured && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
            <FlaskConical className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
            <p><span className="font-semibold">Local preview.</span> Data stays in this browser. Email, payment and application submission providers are not connected.</p>
          </div>
        )}
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">{eyebrow}</p>}
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">{description}</p>
          </div>
          {actions}
        </header>
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const style =
    status === "offer" || status === "interview" || status === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "rejected" || status === "failed"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : status === "needs_review" || status === "action_required"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : status === "applied" || status === "viewed" || status === "replied"
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize ${style}`}>{status.replaceAll("_", " ")}</span>;
}
