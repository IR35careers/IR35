"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  FileCheck2,
  Github,
  Loader2,
  LockKeyhole,
  Mail,
  SearchCheck,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { useAuth } from "@/lib/auth-context";
import { resolvePostAuthPath } from "@/lib/auth-routing";
import { authenticatedDestination } from "@/lib/portal-access";
import { validateEmail } from "@/lib/utils";

type AccountMode = "sign-in" | "create" | "forgot";

function providerMessage(provider: "Google" | "GitHub", message: string): string {
  if (/provider is not enabled|unsupported provider|not enabled/i.test(message)) {
    return `${provider} sign-in is being connected. Use email and password for now.`;
  }
  if (/identity is already linked|already been linked/i.test(message)) {
    return `That ${provider} account is already connected. Sign in with it instead.`;
  }
  return message;
}

function AuthPanel({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_35px_120px_-55px_rgba(2,15,25,0.75)] lg:grid lg:grid-cols-[0.94fr_1.06fr]">
      <aside className="relative hidden min-h-[720px] overflow-hidden bg-[#06131e] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-12">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-emerald-500/20 blur-[95px]" />
          <div className="absolute -bottom-24 -right-20 h-96 w-96 rounded-full bg-cyan-400/10 blur-[110px]" />
          <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:42px_42px]" />
        </div>
        <div className="relative"><Brand tone="dark" /></div>
        <div className="relative max-w-md">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-bold text-emerald-200">
            <Sparkles size={14} /> Built for UK contractors
          </span>
          <h2 className="mt-7 text-[2.7rem] font-semibold leading-[1.02] tracking-[-0.055em]">
            One professional profile. Every contract application ready.
          </h2>
          <p className="mt-5 max-w-sm text-base leading-7 text-slate-300">
            Find the right roles, tailor your resume with evidence, and keep every employer response connected to your tracker.
          </p>
          <div className="mt-9 space-y-4">
            {[
              { icon: SearchCheck, title: "Contract-focused search", copy: "Compare IR35 status, rate and working pattern." },
              { icon: FileCheck2, title: "Application-ready profile", copy: "Reuse approved facts without repeating forms." },
              { icon: Github, title: "GitHub evidence import", copy: "Bring verified public projects and technical skills into your profile." },
            ].map(({ icon: Icon, title, copy }) => (
              <div key={title} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.055] p-4 backdrop-blur">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-200"><Icon size={19} /></span>
                <div><p className="text-sm font-bold text-white">{title}</p><p className="mt-1 text-xs leading-5 text-slate-400">{copy}</p></div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck size={15} className="text-emerald-300" /> Your profile remains private until you approve an application.
        </div>
      </aside>
      <div className="min-h-[680px] p-5 sm:p-9 lg:flex lg:items-center lg:p-12">{children}</div>
    </section>
  );
}

export default function SignInForm() {
  const {
    user,
    loading,
    signInWithPassword,
    signUpWithPassword,
    requestPasswordReset,
    signInWithGoogle,
    signInWithGithub,
    signOut,
  } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = resolvePostAuthPath(searchParams.get("next"));
  const switchRequested = searchParams.get("switch") === "1";
  const selectGoogleAccount = searchParams.get("select_account") === "1";
  const signupNext = searchParams.get("next") ? next : "/profile#application-readiness";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<AccountMode>(searchParams.get("mode") === "create" ? "create" : "sign-in");
  const [submitting, setSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"google" | "github" | null>(null);
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
      router.replace(`/account?mode=signin&select_account=1&next=${encodeURIComponent(next)}`);
    });
    return () => { cancelled = true; };
  }, [loading, next, router, signOut, switchRequested]);

  useEffect(() => {
    if (!loading && user && !switchRequested) {
      const destination = authenticatedDestination(user.email, next);
      if (destination.startsWith("https://")) window.location.replace(destination);
      else router.replace(destination);
    }
  }, [user, loading, next, router, switchRequested]);

  const selectMode = (selected: Exclude<AccountMode, "forgot">) => {
    setMode(selected);
    setError(null);
    setConfirmSent(false);
    setResetSent(false);
  };

  const requireLegalConsent = (): boolean => {
    if (mode !== "create" || legalAccepted) return true;
    setError("Accept the Terms of Use and acknowledge the Privacy Notice before creating your account.");
    return false;
  };

  const startSocial = async (provider: "google" | "github") => {
    setError(null);
    if (!requireLegalConsent()) return;
    setSocialLoading(provider);
    const destination = mode === "create" ? signupNext : next;
    const result = provider === "google"
      ? await signInWithGoogle(destination, selectGoogleAccount)
      : await signInWithGithub(destination);
    if (result.error) {
      setError(providerMessage(provider === "google" ? "Google" : "GitHub", result.error));
      setSocialLoading(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validateEmail(email)) return setError("Enter a valid email address.");
    if (mode !== "forgot" && password.length < 8) return setError("Password must be at least 8 characters.");
    if (!requireLegalConsent()) return;
    setSubmitting(true);

    if (mode === "forgot") {
      const result = await requestPasswordReset(email);
      setSubmitting(false);
      if (result.error) return setError(result.error);
      setResetSent(true);
      return;
    }
    if (mode === "sign-in") {
      const result = await signInWithPassword(email, password);
      if (result.error) {
        setSubmitting(false);
        return setError("We couldn't sign you in with those details. Check them and try again.");
      }
      const destination = authenticatedDestination(email, next);
      if (destination.startsWith("https://")) window.location.replace(destination);
      else router.replace(destination);
      return;
    }
    const result = await signUpWithPassword(email, password, signupNext);
    if (result.error) {
      setSubmitting(false);
      return setError(/already registered|already exists|user already/i.test(result.error)
        ? "That email may already have an account. Try signing in instead."
        : result.error);
    }
    if (result.needsConfirmation) {
      setSubmitting(false);
      setConfirmSent(true);
      return;
    }
    router.replace(signupNext);
  };

  if (switchingAccount || switchRequested || (!loading && user)) {
    return <AuthPanel><div className="mx-auto flex w-full max-w-md items-center justify-center gap-3 text-sm font-semibold text-slate-700"><Loader2 className="animate-spin" size={19} /> Preparing secure sign-in</div></AuthPanel>;
  }

  if (confirmSent || resetSent) {
    return (
      <AuthPanel>
        <div className="mx-auto w-full max-w-md text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800"><CheckCircle2 size={30} /></div>
          <p className="mt-7 ir35-eyebrow">Secure account</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">Check your inbox</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">We sent {resetSent ? "a one-use password reset link" : "an account confirmation link"} to <strong className="text-slate-900">{email}</strong>.</p>
          <Link href="/jobs" className="ir35-focus mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Browse contracts <ArrowRight size={15} /></Link>
        </div>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel>
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center justify-between lg:hidden"><Brand /><Link href="/" className="text-xs font-semibold text-slate-500 hover:text-slate-950">Home</Link></div>
        <p className="mt-8 ir35-eyebrow lg:mt-0">Contractor workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-[2.15rem]">
          {mode === "sign-in" ? "Welcome back" : mode === "forgot" ? "Reset your password" : "Create your account"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {mode === "sign-in" ? "Sign in to continue to your contracts, applications and recruiter messages." : mode === "forgot" ? "Enter your account email. We will send a secure reset link." : "Create your free account, then import your resume or GitHub evidence to complete your profile faster."}
        </p>

        {mode !== "forgot" && (
          <div className="mt-6 grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1" aria-label="Account action">
            {(["sign-in", "create"] as const).map((item) => (
              <button key={item} type="button" onClick={() => selectMode(item)} aria-pressed={mode === item} className={`ir35-focus min-h-10 rounded-lg px-3 text-sm font-bold transition ${mode === item ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                {item === "sign-in" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-xs font-bold uppercase tracking-[0.08em] text-slate-600" htmlFor="account-email">Email address
            <span className="mt-2 flex min-h-12 items-center gap-3 rounded-xl border border-slate-300 bg-slate-50 px-3.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
              <Mail size={17} className="shrink-0 text-slate-400" />
              <input id="account-email" type="email" autoComplete={mode === "sign-in" ? "username" : "email"} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="min-w-0 flex-1 bg-transparent py-3 text-sm font-normal normal-case tracking-normal text-slate-950 outline-none placeholder:text-slate-400" />
            </span>
          </label>
          {mode !== "forgot" && (
            <div className="block text-xs font-bold uppercase tracking-[0.08em] text-slate-600">
              <label htmlFor="account-password">Password</label>
              <div className="mt-2 flex min-h-12 items-center gap-3 rounded-xl border border-slate-300 bg-slate-50 px-3.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                <LockKeyhole size={17} className="shrink-0 text-slate-400" />
                <input id="account-password" type={showPassword ? "text" : "password"} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" className="min-w-0 flex-1 bg-transparent py-3 text-sm font-normal normal-case tracking-normal text-slate-950 outline-none placeholder:text-slate-400" />
                <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide entered value" : "Show entered value"} title={showPassword ? "Hide password" : "Show password"} className="ir35-focus flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>
          )}

          {mode === "sign-in" && <button type="button" onClick={() => { setMode("forgot"); setError(null); }} className="ir35-focus min-h-9 rounded-lg text-sm font-semibold text-brand-700 hover:underline">Forgot your password?</button>}

          {mode === "create" && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              <input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-700" />
              <span>I agree to the <Link href="/terms" target="_blank" className="font-bold text-brand-700 underline underline-offset-2">Terms of Use</Link> and acknowledge the <Link href="/privacy" target="_blank" className="font-bold text-brand-700 underline underline-offset-2">Privacy Notice</Link>.</span>
            </label>
          )}

          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-semibold leading-5 text-rose-700">{error}</p>}

          <button type="submit" disabled={submitting} className="ir35-focus flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white shadow-[0_12px_30px_-18px_rgba(4,120,87,.9)] hover:bg-brand-800 disabled:cursor-wait disabled:opacity-60">
            {submitting ? <Loader2 size={17} className="animate-spin" /> : <>{mode === "sign-in" ? "Sign in" : mode === "forgot" ? "Send reset link" : "Create free account"}<ArrowRight size={16} /></>}
          </button>
        </form>

        {mode === "forgot" ? (
          <button type="button" onClick={() => { setMode("sign-in"); setError(null); }} className="ir35-focus mt-4 min-h-10 w-full rounded-lg text-sm font-semibold text-slate-600 hover:text-slate-950">Back to sign in</button>
        ) : (
          <>
            <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200" /><span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">or continue with</span><span className="h-px flex-1 bg-slate-200" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => void startSocial("google")} disabled={Boolean(socialLoading)} className="ir35-focus flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">
                {socialLoading === "google" ? <Loader2 className="animate-spin" size={17} /> : <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-white text-sm font-black text-[#4285f4] shadow-sm">G</span>} Google
              </button>
              <button type="button" onClick={() => void startSocial("github")} disabled={Boolean(socialLoading)} className="ir35-focus flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-slate-950 bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60">
                {socialLoading === "github" ? <Loader2 className="animate-spin" size={17} /> : <Github size={18} />} GitHub
              </button>
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-700" /> GitHub can fill missing public skills and project evidence. You review and edit everything in your profile.</p>
          </>
        )}
        <p className="mt-6 text-center text-xs leading-5 text-slate-500">By using IR35Careers, you can save contracts and prepare reviewed application materials. Read our <Link href="/privacy" className="font-bold text-brand-700 hover:underline">Privacy Notice</Link>.</p>
      </div>
    </AuthPanel>
  );
}
