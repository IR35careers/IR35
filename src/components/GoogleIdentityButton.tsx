"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { configuredGoogleClientId, createGoogleIdentityAttempt, googleIdentityApi, googleRedirectFallbackEnabled } from "@/lib/google-identity";
import { resolvePostAuthPath } from "@/lib/auth-routing";
import { authenticatedDestination } from "@/lib/portal-access";
import { promiseWithTimeout } from "@/lib/authenticated-fetch";
import { isSupabaseConfigured } from "@/lib/supabase-config";

export function GoogleIdentityButton({ admin = false, mode = "sign-in", next, selectAccount = false, disabled = false, nonce, onError }: {
  admin?: boolean; mode?: "sign-in" | "create"; next?: string; selectAccount?: boolean;
  disabled?: boolean; nonce?: string; onError: (message: string) => void;
}) {
  const { signInWithGoogle, signInWithGoogleAdmin, signInWithGoogleIdToken } = useAuth();
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const errorCallback = useRef(onError);
  const [scriptReady, setScriptReady] = useState(false);
  const [buttonReady, setButtonReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [generation, setGeneration] = useState(0);
  const clientId = configuredGoogleClientId();
  const configured = isSupabaseConfigured() && Boolean(clientId);
  const destination = resolvePostAuthPath(next || (mode === "create" ? "/profile#application-readiness" : "/dashboard"));
  const fallbackEnabled = googleRedirectFallbackEnabled();
  useEffect(() => { errorCallback.current = onError; }, [onError]);

  useEffect(() => {
    if (!configured || disabled || scriptReady) return;
    const timer = setTimeout(() => setProblem("Google sign-in did not load. Try again, use email, or use the redirect fallback if enabled."), 15_000);
    return () => clearTimeout(timer);
  }, [configured, disabled, scriptReady, generation]);

  useEffect(() => {
    if (!configured || !clientId || disabled || !scriptReady || !container.current) return;
    let active = true;
    let inFlight = false;
    let attempt: Awaited<ReturnType<typeof createGoogleIdentityAttempt>> | null = null;
    const api = googleIdentityApi((window as Window & { google?: { accounts?: { id?: unknown } } }).google?.accounts?.id);
    const host = container.current;
    setButtonReady(false); setProblem("");
    if (!api) { setProblem("Google sign-in could not initialize. Use email or try again."); return; }
    void createGoogleIdentityAttempt(clientId).then(value => {
      if (!active) { value.discard(); return; }
      attempt = value;
      api.initialize({ client_id: clientId, nonce: value.hashedNonce, auto_select: false,
        button_auto_select: false, use_fedcm_for_button: true, ux_mode: "popup", context: mode === "create" ? "signup" : "signin",
        callback: response => {
          if (!active || inFlight) return;
          inFlight = true; setBusy(true); errorCallback.current("");
          void promiseWithTimeout(value.exchange(response, signInWithGoogleIdToken), 20_000, "Google verification timed out. Try again or use email.").then(result => {
            if (!active) return;
            if (result.error) { setProblem(result.error); errorCallback.current(result.error); return; }
            // Admin access is still verified by /api/admin/session, not token metadata.
            if (admin) { router.refresh(); return; }
            const target = authenticatedDestination(result.email, destination);
            if (target.startsWith("https://")) window.location.replace(target);
            else router.replace(target);
          }).catch(() => {
            if (!active) return;
            const message = "Google sign-in could not be verified. Choose Try Google again or use email.";
            setProblem(message); errorCallback.current(message);
          }).finally(() => { inFlight = false; if (active) setBusy(false); });
        },
      });
      api.renderButton(host, { type: "standard", theme: "outline", size: "large", text: mode === "create" ? "signup_with" : "signin_with", width: Math.max(200, Math.min(400, Math.floor(host.getBoundingClientRect().width))), shape: "rectangular", locale: "en_GB" });
      setButtonReady(true);
    }).catch(() => { if (active) setProblem("Google sign-in could not initialize securely. Use email or try again."); });
    return () => { active = false; attempt?.discard(); api.cancel(); host.replaceChildren(); };
  }, [admin, clientId, configured, destination, disabled, generation, mode, router, scriptReady, signInWithGoogleIdToken]);

  const fallback = async () => {
    if (!fallbackEnabled || disabled || busy) return;
    setBusy(true); errorCallback.current("");
    try {
      const result = admin ? await signInWithGoogleAdmin() : await signInWithGoogle(destination, selectAccount);
      if (result.error) { errorCallback.current(result.error); setProblem(result.error); setBusy(false); }
    } catch { setProblem("Google redirect could not start. Use email or try again."); setBusy(false); }
  };
  return <div className="min-w-0 space-y-2">
    {configured && !disabled && <Script id="ir35-google-identity" src="https://accounts.google.com/gsi/client" nonce={nonce} strategy="afterInteractive" onReady={() => setScriptReady(true)} onError={() => setProblem("Google sign-in was blocked or unavailable. Use email or the enabled redirect fallback.")} />}
    <div className="relative min-h-11" aria-busy={busy || (configured && !disabled && !buttonReady)}>
      <div ref={container} role="group" inert={disabled || busy || Boolean(problem)} className={disabled || busy || problem ? "pointer-events-none opacity-60" : ""} aria-label="Google Identity Services sign-in" />
      {(!buttonReady || disabled || busy) && <p role="status" className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-center text-xs leading-5 ${admin ? "border-white/20 text-slate-200" : "border-slate-300 text-slate-700"}`}>
        {busy || (configured && !disabled && !problem) ? <Loader2 size={16} className="shrink-0 animate-spin" /> : null}
        {disabled ? "Accept the terms above to continue with Google, or finish the current account action." : !configured ? "Google sign-in is unavailable here. Use email." : busy ? "Verifying Google sign-in" : problem ? "Google sign-in needs attention" : "Loading secure Google button"}
      </p>}
    </div>
    {problem && <p role="status" className={`text-xs leading-5 ${admin ? "text-amber-200" : "text-amber-900"}`}>{problem}</p>}
    {problem && configured && !disabled && <button type="button" disabled={busy} onClick={() => {
      if (!scriptReady) { window.location.reload(); return; }
      errorCallback.current(""); setProblem(""); setGeneration(value => value + 1);
    }} className={`ir35-focus min-h-10 rounded-lg px-2 text-xs font-semibold underline ${admin ? "text-emerald-200" : "text-brand-700"}`}>{scriptReady ? "Try Google again" : "Reload Google sign-in"}</button>}
    {fallbackEnabled && <button type="button" disabled={disabled || busy} onClick={() => void fallback()} className={`ir35-focus min-h-10 w-full rounded-lg px-2 text-xs font-semibold underline disabled:opacity-50 ${admin ? "text-slate-200" : "text-slate-700"}`}>Use Google redirect fallback</button>}
  </div>;
}
