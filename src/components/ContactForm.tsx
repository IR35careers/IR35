"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";

export function ContactForm() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(null);
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form.entries())) });
      const payload = (await response.json()) as { error?: string; message?: string };
      setResult({ ok: response.ok, message: payload.message ?? payload.error ?? "We could not process the form." });
      if (response.ok) event.currentTarget.reset();
    } catch {
      setResult({ ok: false, message: "We could not reach the contact service. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  return <form onSubmit={submit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-7"><div className="grid gap-5 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-800">Name<input name="name" required minLength={2} className="ir35-focus mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 font-normal" /></label><label className="text-sm font-semibold text-slate-800">Email<input name="email" type="email" required className="ir35-focus mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 font-normal" /></label><label className="text-sm font-semibold text-slate-800 sm:col-span-2">Company or project <span className="font-normal text-slate-500">(optional)</span><input name="company" className="ir35-focus mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 font-normal" /></label><label className="hidden" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label><label className="text-sm font-semibold text-slate-800 sm:col-span-2">How can we help?<textarea name="message" required minLength={20} rows={7} className="ir35-focus mt-2 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-4 font-normal leading-6" /></label></div><p className="mt-4 text-xs leading-5 text-slate-500">We use these details only to respond to your enquiry, as explained in our <Link href="/privacy" className="font-semibold text-brand-700 hover:underline">Privacy Notice</Link>. Please do not include Resumes or sensitive personal information here.</p><button type="submit" disabled={busy} className="ir35-focus mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} Send enquiry</button>{result && <p role={result.ok ? "status" : "alert"} className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{result.ok && <CheckCircle2 className="mt-0.5 shrink-0" size={16} />}{result.message}</p>}</form>;
}
