"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, CloudOff, Loader2 } from "lucide-react";
import { ApplicationStudio } from "@/components/workspace/ApplicationStudio";
import { AppNav } from "@/components/AppNav";
import { useAuth } from "@/lib/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { useWorkspaceCloudSync, useWorkspaceState } from "@/lib/workspace/store";
import { useContractorPortalBoundary } from "@/components/useContractorPortalBoundary";

export function HistoricalApplicationResolver({
  applicationId,
  jobId,
}: {
  applicationId: string;
  jobId: string;
}) {
  const configured = isSupabaseConfigured();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const administratorRedirect = useContractorPortalBoundary(user?.email, authLoading);
  const cloud = useWorkspaceCloudSync(configured && !administratorRedirect ? user?.id ?? null : null, user?.email ?? "");
  const workspace = useWorkspaceState();

  useEffect(() => {
    if (configured && !administratorRedirect && !authLoading && !user) {
      const returnTo = `/applications/new/${encodeURIComponent(jobId)}?applicationId=${encodeURIComponent(applicationId)}`;
      router.replace(`/account?next=${encodeURIComponent(returnTo)}`);
    }
  }, [administratorRedirect, applicationId, authLoading, configured, jobId, router, user]);

  if (configured && (administratorRedirect || authLoading || !user || cloud.loading)) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500" aria-busy="true"><Loader2 className="animate-spin" size={22} /><span className="sr-only">Loading saved application</span></main>;
  }

  if (configured && cloud.error) {
    return <div className="min-h-screen bg-slate-50"><AppNav /><main className="mx-auto max-w-2xl px-4 py-16 sm:px-6"><div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-950" role="alert"><CloudOff size={24} /><h1 className="mt-4 text-xl font-semibold">We could not open this application</h1><p className="mt-2 text-sm leading-6">Please check your connection and try again. Your saved application has not been changed.</p><button type="button" onClick={() => window.location.reload()} className="ir35-focus mt-5 min-h-11 rounded-xl bg-rose-800 px-4 text-sm font-bold text-white">Try again</button></div></main></div>;
  }

  const application = workspace.applications.find((item) => item.id === applicationId && item.job.id === jobId);
  if (application) return <ApplicationStudio job={application.job} />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AppNav />
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-card">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-600"><ArchiveRestore size={24} aria-hidden="true" /></span>
          <h1 className="mt-5 text-2xl font-semibold">Application record unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">The original listing is no longer active and this application is not in the signed-in account.</p>
          <Link href="/applications" className="ir35-focus mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-5 text-sm font-bold text-white">Return to Tracker</Link>
        </section>
      </main>
    </div>
  );
}
