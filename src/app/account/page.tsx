"use client";

/**
 * /account — one combined email + password screen.
 *
 * The user enters email + password and hits continue. We try to sign in; if
 * the account doesn't exist yet, we transparently sign them up instead. No
 * separate login/register pages — one box, one button.
 *
 * Design: matches the site's dark emerald/sky identity.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowRight, Loader2, Briefcase, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { validateEmail } from "@/lib/utils";

function AccountForm() {
  const { user, loading, signInWithPassword, signUpWithPassword } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  // Already signed in → leave this page.
  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [user, loading, next, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);

    // Try sign-in first.
    const signIn = await signInWithPassword(email, password);
    if (!signIn.error) {
      router.replace(next);
      return;
    }

    // "Invalid login credentials" means either wrong password OR no account.
    // Attempt sign-up; if the email already exists, Supabase returns a clear
    // error and we surface it as a wrong-password hint.
    const looksLikeNoAccount = /invalid login credentials/i.test(signIn.error);
    if (looksLikeNoAccount) {
      const signUp = await signUpWithPassword(email, password);
      if (signUp.error) {
        // Account exists but password was wrong (sign-up rejects duplicate).
        if (/already registered|already exists|user already/i.test(signUp.error)) {
          setError("That email is already registered — check your password and try again.");
        } else {
          setError(signUp.error);
        }
        setSubmitting(false);
        return;
      }
      if (signUp.needsConfirmation) {
        setConfirmSent(true);
        setSubmitting(false);
        return;
      }
      router.replace(next);
      return;
    }

    setError(signIn.error);
    setSubmitting(false);
  };

  if (!loading && user) return null;

  if (confirmSent) {
    return (
      <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-black/60 p-8 text-center backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/15">
          <CheckCircle2 className="h-7 w-7 text-emerald-300" />
        </div>
        <h1 className="mt-5 text-xl font-medium text-white">Check your inbox</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          We&apos;ve sent a confirmation link to{" "}
          <span className="text-white/80">{email}</span>. Click it to activate your account, then
          come back and sign in.
        </p>
        <Link
          href="/jobs"
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-white/60 underline-offset-4 hover:text-white hover:underline"
        >
          Browse contracts meanwhile
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-black/60 p-8 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-sky-500">
          <Briefcase size={15} className="text-black" />
        </div>
        <span className="text-sm font-bold text-white">
          IR35<span className="text-white/70">Careers</span>
        </span>
      </div>

      <h1 className="mt-6 text-2xl font-light tracking-tight text-white">Sign in or create account</h1>
      <p className="mt-1.5 text-sm text-white/55">
        One step — we&apos;ll sign you in, or set you up if you&apos;re new.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-white/60">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-white/60">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
          />
        </div>

        {error && (
          <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-sky-400 px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <>
              Continue <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-white/40">
        By continuing you agree to browse and apply for roles via their original listings.
      </p>
    </div>
  );
}

export default function AccountPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black px-4">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-32 right-[-10%] h-[420px] w-[420px] rounded-full bg-emerald-500/[0.10] blur-[120px]" />
        <div className="absolute bottom-[-15%] left-[-10%] h-[420px] w-[420px] rounded-full bg-sky-500/[0.09] blur-[130px]" />
      </div>
      <div className="relative">
        <Suspense
          fallback={
            <div className="flex h-64 items-center justify-center text-white/50">
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
