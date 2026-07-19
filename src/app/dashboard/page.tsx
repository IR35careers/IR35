"use client";

/**
 * /dashboard — the signed-in home. Protected: signed-out users are bounced to
 * /account. This is a placeholder shell; CV upload, matching, and the
 * applications tracker land here in later phases.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, Search, FileText, LayoutGrid, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export default function DashboardPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/account?next=/dashboard");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white/50">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-black text-white">
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="absolute -top-40 right-[-10%] h-[440px] w-[440px] rounded-full bg-emerald-500/[0.08] blur-[120px]" />
        <div className="absolute bottom-[-15%] left-[-10%] h-[440px] w-[440px] rounded-full bg-sky-500/[0.07] blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/" className="text-sm text-white/40 transition-colors hover:text-white/70">
              IR35Careers
            </Link>
            <h1 className="mt-2 text-2xl font-light tracking-tight sm:text-3xl">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-white/50">{user.email}</p>
          </div>
          <button
            onClick={() => signOut()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-sm text-white/70 transition-colors hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>

        {/* Quick actions */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Link
            href="/jobs"
            className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-colors hover:border-white/25 hover:bg-white/[0.07]"
          >
            <Search className="text-emerald-300" size={22} />
            <h2 className="mt-3 font-medium">Browse contracts</h2>
            <p className="mt-1 text-sm text-white/50">
              Search live Inside &amp; Outside IR35 roles.
            </p>
          </Link>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 opacity-70">
            <FileText className="text-white/40" size={22} />
            <h2 className="mt-3 font-medium text-white/80">Upload your CV</h2>
            <p className="mt-1 text-sm text-white/45">
              Coming soon — save your CV and preferences.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 opacity-70">
            <LayoutGrid className="text-white/40" size={22} />
            <h2 className="mt-3 font-medium text-white/80">Your applications</h2>
            <p className="mt-1 text-sm text-white/45">
              Coming soon — track saved and applied roles.
            </p>
          </div>
        </div>

        <p className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Your account is live. CV upload, personalised match scores, and the applications tracker
          are coming next — for now, jump into the board and start browsing.
        </p>
      </div>
    </main>
  );
}
