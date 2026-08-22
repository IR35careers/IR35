"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, FlaskConical, Loader2 } from "lucide-react";
import { AppNav } from "@/components/AppNav";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceCloudSync } from "@/lib/workspace/store";
import { useContractorPortalBoundary } from "@/components/useContractorPortalBoundary";

export function WorkspacePage({
  title,
  description,
  eyebrow,
  actions,
  children,
  density = "default",
}: {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  density?: "default" | "compact";
}) {
  const configured = isSupabaseConfigured();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const administratorRedirect = useContractorPortalBoundary(user?.email, authLoading);
  const cloud = useWorkspaceCloudSync(configured && !administratorRedirect ? user?.id ?? null : null, user?.email ?? "");

  useEffect(() => {
    if (configured && !administratorRedirect && !authLoading && !user) router.replace(`/account?next=${encodeURIComponent(window.location.pathname)}`);
  }, [administratorRedirect, authLoading, configured, router, user]);

  if (configured && (administratorRedirect || authLoading || !user || cloud.loading)) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500" aria-busy="true"><Loader2 className="animate-spin" size={22} /><span className="sr-only">Loading your private workspace</span></main>;
  }

  if (configured && cloud.error) {
    return <div className="min-h-screen bg-slate-50"><AppNav /><main className="mx-auto max-w-2xl px-4 py-16 sm:px-6"><div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-950" role="alert"><CloudOff size={24} /><h1 className="mt-4 text-xl font-semibold">We could not open your workspace</h1><p className="mt-2 text-sm leading-6">Please check your connection and try again. Your information remains protected.</p><button type="button" onClick={() => window.location.reload()} className="ir35-focus mt-5 min-h-11 rounded-xl bg-rose-800 px-4 text-sm font-bold text-white">Try again</button></div></main></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AppNav />
      <main className={`mx-auto max-w-[1600px] px-4 sm:px-6 ${density === "compact" ? "py-5 lg:py-6" : "py-7 lg:py-8"}`}>
        {!configured && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
            <FlaskConical className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
            <p><span className="font-semibold">Preview mode.</span> Changes are kept in this browser only.</p>
          </div>
        )}
        <header className={`flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between ${density === "compact" ? "pb-2" : "pb-3"}`}>
          <div className="max-w-3xl">
            {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">{eyebrow}</p>}
            <h1 className={`mt-1 font-semibold tracking-[-0.03em] text-slate-950 ${density === "compact" ? "text-2xl sm:text-3xl" : "text-3xl sm:text-[2.5rem]"}`}>{title}</h1>
            <p className={`mt-2 text-slate-600 ${density === "compact" ? "max-w-2xl text-sm leading-5" : "max-w-3xl text-sm leading-6 sm:text-base"}`}>{description}</p>
          </div>
          {actions}
        </header>
        <div className={density === "compact" ? "mt-4" : "mt-5"}>{children}</div>
      </main>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const label = status === "needs_review" ? "Needs you" : status.replaceAll("_", " ");
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
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize ${style}`}>{label}</span>;
}
