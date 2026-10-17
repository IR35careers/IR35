"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Github, Loader2, RefreshCw } from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { resolvePostAuthPath } from "@/lib/auth-routing";
import { getSupabase } from "@/lib/supabase";

type ImportState = "waiting" | "importing" | "success" | "error";

function GithubCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = resolvePostAuthPath(searchParams.get("next"));
  const oauthError = searchParams.get("error");
  const oauthErrorDetails = [
    searchParams.get("error_code"),
    searchParams.get("error_description"),
    oauthError,
  ].filter(Boolean).join(" ");
  const providerUnavailable = /provider is not enabled|unsupported provider|not enabled/i.test(oauthErrorDetails);
  const [status, setStatus] = useState<ImportState>("waiting");
  const [message, setMessage] = useState("Securing your GitHub connection.");
  const started = useRef(false);

  const importProfile = useCallback(async () => {
    setStatus("importing");
    setMessage("Reading professional details from your GitHub profile.");
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      setStatus("error");
      setMessage("The GitHub sign-in could not be confirmed. Please try again.");
      return;
    }

    const response = await fetch("/api/integrations/github/profile", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ providerToken: data.session.provider_token ?? "" }),
    });
    const payload = (await response.json()) as { error?: string; updatedFields?: string[] };
    if (!response.ok) {
      setStatus("error");
      setMessage(payload.error ?? "GitHub profile import failed. Your account is still secure.");
      return;
    }

    setStatus("success");
    const updated = payload.updatedFields?.length
      ? `Added ${payload.updatedFields.join(", ")} to your profile.`
      : "Your GitHub account is connected. Existing profile details were preserved.";
    setMessage(updated);
    window.setTimeout(() => router.replace(destination), 1100);
  }, [destination, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (oauthError) {
      setStatus("error");
      setMessage(providerUnavailable
        ? "GitHub sign-in is temporarily unavailable. Use Google or email while the connection is restored."
        : "GitHub did not complete the secure connection. Return to sign in and try again.");
      return;
    }
    const timer = window.setTimeout(() => void importProfile(), 250);
    return () => window.clearTimeout(timer);
  }, [importProfile, oauthError, providerUnavailable]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07131d] px-4 py-10 [color-scheme:light]">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-[-10%] top-[-20%] h-[520px] w-[520px] rounded-full bg-emerald-500/20 blur-[130px]" />
        <div className="absolute bottom-[-25%] right-[-8%] h-[500px] w-[500px] rounded-full bg-cyan-500/10 blur-[140px]" />
      </div>
      <section className="relative w-full max-w-lg rounded-[2rem] border border-white/10 bg-white p-7 shadow-[0_32px_90px_-40px_rgba(0,0,0,0.8)] sm:p-9">
        <Brand />
        <div className="mt-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white">
          {status === "success" ? <CheckCircle2 size={28} /> : status === "error" ? <RefreshCw size={25} /> : status === "importing" ? <Loader2 className="animate-spin" size={26} /> : <Github size={28} />}
        </div>
        <p className="mt-6 ir35-eyebrow">GitHub profile</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
          {status === "success" ? "Your profile is ready" : status === "error" ? "Connection needs another try" : "Connecting your professional profile"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600" role="status">{message}</p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          {status === "error" ? (
            oauthError ? (
              <Link href={`/account?next=${encodeURIComponent(destination)}`} className="ir35-focus inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800">
                <RefreshCw size={16} /> Return to sign in
              </Link>
            ) : (
              <button type="button" onClick={() => void importProfile()} className="ir35-focus inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800">
                <RefreshCw size={16} /> Try again
              </button>
            )
          ) : (
            <div className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-50 px-5 text-sm font-semibold text-emerald-900">
              {status === "success" ? <CheckCircle2 size={16} /> : <Loader2 className="animate-spin" size={16} />}
              {status === "success" ? "Connected securely" : "Working securely"}
            </div>
          )}
          <Link href={destination} className="ir35-focus inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Continue without import
          </Link>
        </div>
        <p className="mt-6 text-xs leading-5 text-slate-500">
          IR35Careers imports public professional details and repository evidence. It never stores your GitHub access token or overwrites information you already added.
        </p>
      </section>
    </main>
  );
}

export default function GithubCallbackPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#07131d] text-white"><Loader2 className="animate-spin" /></main>}>
      <GithubCallbackContent />
    </Suspense>
  );
}
