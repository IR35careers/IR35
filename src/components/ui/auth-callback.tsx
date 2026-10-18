"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { EmailConfirmationForm } from "@/components/ui/email-confirmation-form";
import { accountSignInPath, authCallbackPath } from "@/lib/auth-routing";
import { authCallbackDetails, completeAuthCallback, type AuthCallbackOutcome } from "@/lib/auth-confirmation";
import { promiseWithTimeout } from "@/lib/authenticated-fetch";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { authenticatedDestination } from "@/lib/portal-access";

type Result = { next: string; outcome: AuthCallbackOutcome };

export function AuthCallback() {
  const router = useRouter();
  const attempt = useRef<Promise<Result> | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    let active = true;
    // Reuse the attempt under Strict Mode. A one-use code must not be replayed.
    if (!attempt.current) attempt.current = (async (): Promise<Result> => {
      const details = authCallbackDetails(window.location.href);
      try {
        if (details.failure) return { next: details.next, outcome: { state: details.failure } };
        if (!isSupabaseConfigured()) return { next: details.next, outcome: { state: "invalid" } };
        const { getSupabase } = await import("@/lib/supabase");
        const outcome = await promiseWithTimeout(completeAuthCallback(getSupabase().auth), 15_000, "Authentication timed out");
        return { next: details.next, outcome };
      } catch { return { next: details.next, outcome: { state: "invalid" } }; }
      finally {
        // Do not leave tokens or provider error details in history/referrers.
        window.history.replaceState(window.history.state, "", authCallbackPath(details.next));
      }
    })();
    void attempt.current.then(value => {
      if (!active) return;
      setResult(value);
      if (value.outcome.state === "confirmed") {
        const destination = authenticatedDestination(value.outcome.email, value.next);
        if (destination.startsWith("https://")) window.location.replace(destination);
        else router.replace(destination);
      }
    });
    return () => { active = false; };
  }, [router]);

  const state = result?.outcome.state;
  const pending = !result || state === "confirmed";
  return (
    <main className="flex min-h-screen items-center justify-center bg-emerald-50 px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl border border-emerald-200 bg-white p-6 shadow-card sm:p-9">
        <Brand />
        <ShieldCheck className="mt-8 text-brand-700" size={32} />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">{pending ? "Completing secure sign-in" : state === "expired" ? "This confirmation link has expired" : state === "unconfirmed" ? "Confirm your email to apply" : "This sign-in link could not be verified"}</h1>
        {pending ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-slate-700"><Loader2 size={18} className="animate-spin" /> Checking your account securely…</p> : <>
          <p className="mt-3 text-sm leading-6 text-slate-600">{state === "unconfirmed" ? "Your account email must be confirmed before an application can be submitted." : "Links can expire or be used only once. Request a fresh confirmation email, or return to sign in. For password resets, request a new reset link from sign-in."} Your saved application has not been submitted by this page.</p>
          <EmailConfirmationForm next={result.next} />
          <Link href={accountSignInPath(result.next)} className="ir35-focus mt-5 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-bold text-brand-700 underline underline-offset-4">Return to sign in</Link>
        </>}
      </section>
    </main>
  );
}
