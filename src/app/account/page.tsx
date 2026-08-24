"use client";

/** /account — explicit sign-in and account-creation states. */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { validateEmail } from "@/lib/utils";
import { Brand } from "@/components/ui/brand";
import { resolvePostAuthPath } from "@/lib/auth-routing";
import { authenticatedDestination } from "@/lib/portal-access";
import { GoogleIdentityButton } from "@/components/GoogleIdentityButton";

function AccountForm() {
  const { user, loading, signInWithPassword, signUpWithPassword, requestPasswordReset, signOut } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = resolvePostAuthPath(searchParams.get("next"));
  const switchRequested = searchParams.get("switch") === "1";
  const selectGoogleAccount = searchParams.get("select_account") === "1";
  const signupNext = searchParams.get("next") ? next : "/profile#application-readiness";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "create" | "forgot">(
    searchParams.get("mode") === "create" ? "create" : "sign-in"
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(switchRequested);

  useEffect(() => {
    if (loading || !switchRequested) return;

    let cancelled = false;
    void signOut().finally(() => {
      if (cancelled) return;
      setSwitchingAccount(false);
      router.replace(
        `/account?mode=signin&select_account=1&next=${encodeURIComponent(next)}`,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [loading, next, router, signOut, switchRequested]);

  // Already signed in → leave this page.
  useEffect(() => {
    if (!loading && user && !switchRequested) {
      const destination = authenticatedDestination(user.email, next);
      if (destination.startsWith("https://")) window.location.replace(destination);
      else router.replace(destination);
    }
  }, [user, loading, next, router, switchRequested]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (mode !== "forgot" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (mode === "create" && !legalAccepted) {
      setError("Please accept the Terms of Use and acknowledge the Privacy Notice to create an account.");
      return;
    }

    setSubmitting(true);

    if (mode === "forgot") {
      const reset = await requestPasswordReset(email);
      setSubmitting(false);
      if (reset.error) {
        setError(reset.error);
        return;
      }
      setResetSent(true);
      return;
    }

    if (mode === "sign-in") {
      const signIn = await signInWithPassword(email, password);
      if (signIn.error) {
        setError("We couldn't sign you in with those details. Check them and try again.");
        setSubmitting(false);
        return;
      }

      const destination = authenticatedDestination(email, next);
      if (destination.startsWith("https://")) window.location.replace(destination);
      else router.replace(destination);
      return;
    }

    const signUp = await signUpWithPassword(email, password, signupNext);
    if (signUp.error) {
      setError(
        /already registered|already exists|user already/i.test(signUp.error)
          ? "We couldn't create that account. Try signing in, or use a different email address."
          : signUp.error
      );
      setSubmitting(false);
      return;
    }
    if (signUp.needsConfirmation) {
      setConfirmSent(true);
      setSubmitting(false);
      return;
    }
    router.replace(signupNext);
  };

  if (switchingAccount || switchRequested || (!loading && user)) {
    return (
      <div className="flex w-full max-w-sm items-center justify-center gap-3 rounded-3xl border border-slate-300 bg-white/95 p-8 text-sm font-semibold text-slate-700 backdrop-blur-xl">
        <Loader2 className="animate-spin" size={18} />
        Preparing contractor sign in
      </div>
    );
  }

  if (confirmSent || resetSent) {
    return (
      <div className="w-full max-w-sm rounded-3xl border border-slate-300 bg-white/95 p-8 text-center backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-green-300 bg-green-100">
          <CheckCircle2 className="h-7 w-7 text-green-700" />
        </div>
        <h1 className="mt-5 text-xl font-medium text-slate-900">Check your inbox</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          We&apos;ve sent {resetSent ? "a secure password-reset link" : "an account-confirmation link"} to{" "}
          <span className="text-slate-800">{email}</span>. {resetSent ? "Use it once to choose a new password." : "Click it to activate your account. Once confirmed, we’ll send a short getting-started guide."}
        </p>
        <Link
          href="/jobs"
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline"
        >
          Browse contracts meanwhile
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-3xl border border-slate-300 bg-white/95 p-8 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <Brand />
        <Link href="/" className="text-xs text-slate-600 transition-colors hover:text-slate-900">
          ← Back to home
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1" aria-label="Account action">
        {(["sign-in", "create"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setMode(item);
              setError(null);
            }}
            aria-pressed={mode === item}
            className={`ir35-focus min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors ${
              mode === item ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {item === "sign-in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <h1 className="mt-6 text-2xl font-light tracking-tight text-slate-900">
        {mode === "sign-in" ? "Welcome back" : mode === "forgot" ? "Reset your password" : "Create your account"}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        {mode === "sign-in"
          ? "Sign in to manage saved contracts and alerts."
          : mode === "forgot"
            ? "Enter your account email and we will send a one-use reset link."
            : "Join the public beta and start saving relevant contracts and focused searches."}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-slate-600">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete={mode === "sign-in" ? "username" : "email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50"
          />
        </div>

        {mode === "sign-in" && (
          <button type="button" onClick={() => { setMode("forgot"); setError(null); }} className="ir35-focus min-h-10 rounded-lg text-sm font-semibold text-brand-700 hover:underline">
            Forgot your password?
          </button>
        )}
        {mode !== "forgot" && (
          <div>
            <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-slate-600">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50"
            />
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {mode === "create" && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            <input
              type="checkbox"
              checked={legalAccepted}
              onChange={(event) => setLegalAccepted(event.target.checked)}
              required
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-700"
            />
            <span>
              I agree to the <Link href="/terms" target="_blank" className="font-semibold text-brand-700 underline underline-offset-2">Terms of Use</Link> and acknowledge the <Link href="/privacy" target="_blank" className="font-semibold text-brand-700 underline underline-offset-2">Privacy Notice</Link>. Resume scoring is advisory and does not make hiring decisions.
            </span>
          </label>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="ir35-focus flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-card transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <>
              {mode === "sign-in" ? "Sign in" : mode === "forgot" ? "Send reset link" : "Create account"} <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      {mode === "forgot" && (
        <button type="button" onClick={() => { setMode("sign-in"); setError(null); }} className="ir35-focus mt-4 min-h-10 w-full rounded-lg text-sm font-semibold text-slate-600 hover:text-slate-950">
          Back to sign in
        </button>
      )}

      {mode !== "forgot" && <div className="mt-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" aria-hidden />
        <span className="text-xs text-slate-600">or</span>
        <span className="h-px flex-1 bg-slate-200" aria-hidden />
      </div>}

      {mode !== "forgot" && <div className="mt-4"><GoogleIdentityButton mode={mode === "create" ? "create" : "sign-in"} next={mode === "create" ? signupNext : next} selectAccount={selectGoogleAccount} onError={(message) => setError(/provider is not enabled|unsupported provider/i.test(message) ? "Google sign-in isn't switched on yet. Use email and password for now." : message)} /></div>}

      <p className="mt-4 text-center text-xs leading-5 text-slate-600">
        We use your account to save contracts, searches and reviewed application packets. Submission happens only from IR35Careers when an employer connection is verified and you approve it. Read our <Link href="/privacy" className="font-semibold text-brand-700 hover:underline">Privacy Notice</Link>.
      </p>
    </div>
  );
}

export default function AccountPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 [color-scheme:light]">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-32 right-[-10%] h-[420px] w-[420px] rounded-full bg-green-200/50 blur-[120px]" />
        <div className="absolute bottom-[-15%] left-[-10%] h-[420px] w-[420px] rounded-full bg-green-200/50 blur-[130px]" />
      </div>
      <div className="relative">
        <Suspense
          fallback={
            <div className="flex h-64 items-center justify-center text-slate-500">
              <Loader2 className="animate-spin" size={22} />
            </div>
          }
        >
          <AccountForm />
        </Suspense>
      </div>
    </main>
  );
}
