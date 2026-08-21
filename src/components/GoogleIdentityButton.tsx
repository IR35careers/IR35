"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

type CredentialResponse = { credential?: string };

type GoogleIdentityApi = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        context?: "signin" | "signup" | "use";
        ux_mode?: "popup";
      }) => void;
      renderButton: (parent: HTMLElement, options: {
        type: "standard";
        theme: "outline" | "filled_black";
        size: "large";
        text: "signin_with" | "signup_with" | "continue_with";
        shape: "rectangular";
        logo_alignment: "left";
        width: number;
      }) => void;
    };
  };
};

let googleScriptPromise: Promise<GoogleIdentityApi> | null = null;

function googleApi(): GoogleIdentityApi | undefined {
  return (window as unknown as { google?: GoogleIdentityApi }).google;
}

function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  if (googleApi()) return Promise.resolve(googleApi() as GoogleIdentityApi);
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const script = existing ?? document.createElement("script");
    const onReady = () => googleApi() ? resolve(googleApi() as GoogleIdentityApi) : reject(new Error("Google sign-in did not load."));
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener("error", () => reject(new Error("Google sign-in is unavailable.")), { once: true });
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return googleScriptPromise;
}

export function GoogleIdentityButton({
  next = "/dashboard",
  admin = false,
  mode = "sign-in",
  onError,
}: {
  next?: string;
  admin?: boolean;
  mode?: "sign-in" | "create";
  onError: (message: string) => void;
}) {
  const { signInWithGoogleIdToken, signInWithGoogle, signInWithGoogleAdmin } = useAuth();
  const hostRef = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(false);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!clientId || !hostRef.current) {
      setFallback(true);
      setLoading(false);
      return;
    }
    let active = true;
    loadGoogleIdentity().then((google) => {
      if (!active || !hostRef.current) return;
      const width = Math.max(220, Math.min(400, Math.round(hostRef.current.getBoundingClientRect().width || 320)));
      google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: "popup",
        auto_select: false,
        cancel_on_tap_outside: true,
        context: mode === "create" ? "signup" : "signin",
        callback: async (response) => {
          if (!response.credential) {
            onErrorRef.current("Google did not return a secure identity token. Please try again.");
            return;
          }
          setLoading(true);
          const result = await signInWithGoogleIdToken(response.credential);
          if (result.error) onErrorRef.current(result.error);
          setLoading(false);
        },
      });
      hostRef.current.replaceChildren();
      google.accounts.id.renderButton(hostRef.current, {
        type: "standard",
        theme: admin ? "filled_black" : "outline",
        size: "large",
        text: mode === "create" ? "signup_with" : admin ? "continue_with" : "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
        width,
      });
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      setFallback(true);
      setLoading(false);
      onErrorRef.current(error instanceof Error ? error.message : "Google sign-in is unavailable.");
    });
    return () => { active = false; };
  }, [admin, clientId, mode, signInWithGoogleIdToken]);

  if (fallback) {
    return <button type="button" onClick={async () => {
      setLoading(true);
      const result = admin ? await signInWithGoogleAdmin() : await signInWithGoogle(next);
      if (result.error) onErrorRef.current(result.error);
      setLoading(false);
    }} disabled={loading} className={`flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border px-4 text-sm font-semibold transition disabled:opacity-60 ${admin ? "border-white/10 bg-white/[0.045] text-slate-200 hover:bg-white/[0.08]" : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50"}`}>
      {loading ? <Loader2 size={16} className="animate-spin" /> : <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-950">G</span>}
      Continue with Google
    </button>;
  }

  return <div className="relative min-h-11 w-full overflow-hidden rounded-md">
    <div ref={hostRef} className="flex min-h-11 w-full items-center justify-center [&>div]:w-full" />
    {loading && <div className={`absolute inset-0 flex items-center justify-center rounded-md border ${admin ? "border-white/10 bg-[#111827] text-slate-300" : "border-slate-300 bg-white text-slate-600"}`}><Loader2 size={16} className="animate-spin" /><span className="ml-2 text-sm font-semibold">Loading Google sign-in</span></div>}
  </div>;
}
