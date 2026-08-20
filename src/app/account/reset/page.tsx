"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Loader2, LockKeyhole } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Brand } from "@/components/ui/brand";

export default function ResetPasswordPage() {
  const { user, loading, updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The passwords do not match.");
    setBusy(true);
    const result = await updatePassword(password);
    setBusy(false);
    if (result.error) return setError(result.error);
    setComplete(true);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-card sm:p-9">
        <Brand />
        {loading ? (
          <div className="flex min-h-52 items-center justify-center text-slate-500"><Loader2 className="animate-spin" /></div>
        ) : complete ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="mx-auto text-brand-700" size={40} />
            <h1 className="mt-4 text-2xl font-bold text-slate-950">Password updated</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Your new password is active. You can continue to your contractor workspace.</p>
            <Link href="/dashboard" className="ir35-focus mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700">Open dashboard</Link>
          </div>
        ) : !user ? (
          <div className="py-10 text-center">
            <LockKeyhole className="mx-auto text-slate-400" size={38} />
            <h1 className="mt-4 text-2xl font-bold text-slate-950">Reset link required</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Open the latest password-reset link from your email. For security, each link can be used only once.</p>
            <Link href="/account" className="ir35-focus mt-6 inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700">Return to sign in</Link>
          </div>
        ) : (
          <>
            <p className="mt-8 text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Account security</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Choose a new password</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Use a unique password with at least 8 characters.</p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block text-sm font-semibold text-slate-700">New password
                <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="ir35-focus mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4" />
              </label>
              <label className="block text-sm font-semibold text-slate-700">Confirm new password
                <input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="ir35-focus mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4" />
              </label>
              {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
              <button type="submit" disabled={busy} className="ir35-focus inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">
                {busy ? <Loader2 className="animate-spin" size={16} /> : <LockKeyhole size={16} />} Update password
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
