"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export function GoogleIdentityButton({
  admin = false,
  mode = "sign-in",
  next,
  selectAccount = false,
  onError,
}: {
  admin?: boolean;
  mode?: "sign-in" | "create";
  next?: string;
  selectAccount?: boolean;
  onError: (message: string) => void;
}) {
  const { signInWithGoogle, signInWithGoogleAdmin } = useAuth();
  const [loading, setLoading] = useState(false);

  const startGoogleSignIn = async () => {
    setLoading(true);
    onError("");
    let result;
    if (admin) {
      result = await signInWithGoogleAdmin();
    } else if (mode === "create") {
      result = await signInWithGoogle(
        next || "/profile#application-readiness",
        selectAccount,
      );
    } else {
      result = await signInWithGoogle(next || "/dashboard", selectAccount);
    }
    if (result.error) {
      onError(result.error);
      setLoading(false);
    }
  };

  const label = admin
    ? "Continue with Google"
    : mode === "create"
      ? "Sign up with Google"
      : "Sign in with Google";

  return (
    <button
      type="button"
      onClick={() => void startGoogleSignIn()}
      disabled={loading}
      className={`ir35-focus flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border px-4 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-70 ${admin ? "border-white/10 bg-white/[0.045] text-slate-200 hover:bg-white/[0.08]" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
    >
      {loading ? (
        <Loader2 size={17} className="animate-spin" />
      ) : (
        <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-white text-sm font-bold text-[#4285f4] shadow-sm">G</span>
      )}
      {loading ? "Opening Google sign-in" : label}
    </button>
  );
}
