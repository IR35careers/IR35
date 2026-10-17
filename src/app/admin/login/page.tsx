"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, KeyRound, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { GoogleIdentityButton } from "@/components/GoogleIdentityButton";
import { supabase } from "@/lib/supabase";

export default function AdminLoginPage() {
  const router = useRouter();
  const { user, loading, signInWithPassword, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlocking = useRef(false);

  useEffect(() => {
    if (loading || !user || unlocking.current) return;
    unlocking.current = true;
    setSubmitting(true);

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (response.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setError(result.error ?? "This account is not approved for IR35Careers administration.");
      setSubmitting(false);
      unlocking.current = false;
      await signOut();
    })().catch(async () => {
      setError("We could not verify administrator access. Please try again.");
      setSubmitting(false);
      unlocking.current = false;
      await signOut();
    });
  }, [loading, router, signOut, user]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await signInWithPassword(email, password);
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#070b12] px-5 py-8 text-white sm:px-8 lg:px-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_12%,rgba(16,185,129,0.18),transparent_30%),radial-gradient(circle_at_85%_80%,rgba(14,165,233,0.13),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:44px_44px]" />

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col">
        <header className="flex items-center justify-between">
          <Link href="https://www.ir35careers.com" className="inline-flex items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 shadow-[0_0_35px_rgba(16,185,129,0.18)]">
              <Image src="/images/generated/brand/ir35careers-mark-256.png" alt="" width={29} height={29} priority />
            </span>
            <span><span className="block text-sm font-bold tracking-tight">IR35Careers</span><span className="block text-[10px] font-semibold uppercase tracking-[0.19em] text-slate-500">Control centre</span></span>
          </Link>
          <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-400 sm:inline-flex"><ShieldCheck size={14} className="text-emerald-400" /> Administrator only</span>
        </header>

        <div className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.05fr_0.75fr] lg:py-16">
          <section className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-2 text-xs font-semibold text-emerald-300"><LockKeyhole size={14} /> admin.ir35careers</div>
            <h1 className="mt-7 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl lg:text-6xl">Operate IR35Careers from one secure workspace.</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-400">Review growth, job inventory, applications, campaigns and system health. Administrator access is verified server-side and every sensitive action is recorded.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {["Registry-backed access", "20-minute sessions", "Audited actions"].map((item) => <div key={item} className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-3 text-xs font-medium text-slate-300"><CheckCircle2 size={15} className="shrink-0 text-emerald-400" />{item}</div>)}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.065] p-6 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">Administrator sign in</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Welcome back</h2></div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.07] text-slate-300"><KeyRound size={19} /></span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">Use an approved administrator account. Customer accounts cannot enter this area.</p>

            {user && !loading ? (
              <div className="mt-6 rounded-2xl border border-white/[0.08] bg-black/20 p-4">
                <p className="text-xs text-slate-500">Already signed in as</p><p className="mt-1 truncate text-sm font-semibold text-white">{user.email}</p>
                <button type="button" onClick={() => void signOut()} className="mt-3 text-xs font-semibold text-emerald-300 hover:text-emerald-200">Use a different account</button>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-6 space-y-4">
                <label className="block text-xs font-semibold text-slate-300">Administrator email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@ir35careers.com" className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/10" /></label>
                <label className="block text-xs font-semibold text-slate-300">Password<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/10" /></label>
                {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2.5 text-xs leading-5 text-rose-200">{error}</p>}
                <button type="submit" disabled={submitting || loading} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 text-sm font-bold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-65">{submitting ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}{submitting ? "Verifying account" : "Continue securely"}<ArrowRight size={15} /></button>
              </form>
            )}

            {!user && <><div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-white/[0.08]" /><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">or</span><span className="h-px flex-1 bg-white/[0.08]" /></div><GoogleIdentityButton admin onError={setError} /></>}

            <p className="mt-6 text-center text-[11px] leading-5 text-slate-600">Protected by the administrator registry, server verification and a short-lived HttpOnly session.</p>
            <a
              href="https://www.ir35careers.com/account?switch=1&mode=signin&next=%2Fapplications"
              className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-xl text-xs font-semibold text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              Switch to a contractor account
            </a>
          </section>
        </div>
      </div>
    </main>
  );
}
