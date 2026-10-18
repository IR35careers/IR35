"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { resendConfirmation } from "@/lib/auth-context";
import { confirmationEmailSchema } from "@/lib/auth-confirmation";
import { promiseWithTimeout } from "@/lib/authenticated-fetch";

/** Explicit requests only; never resend automatically when a link is opened. */
export function EmailConfirmationForm({ next, initialEmail = "" }: { next: string; initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1_000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current || cooldown) return;
    setError(""); setNotice("");
    const parsed = confirmationEmailSchema.safeParse(email.trim().toLowerCase());
    if (!parsed.success) { setError("Enter a valid account email address."); return; }
    inFlight.current = true; setPending(true);
    // Rate limiting is also enforced by Supabase; this is just click protection.
    setCooldown(60);
    try {
      const result = await promiseWithTimeout(resendConfirmation(parsed.data, next), 15_000, "Confirmation request timed out. Please try again later.");
      if (result.error) setError(result.error);
      else setNotice("If this account needs confirmation, a new link has been requested. Check your inbox and junk folder, and use only the latest link.");
    } catch { setError("Confirmation request could not finish. Please try again later."); }
    finally { inFlight.current = false; setPending(false); }
  };
  return (
    <form onSubmit={submit} className="mt-6 space-y-4 text-left">
      <label htmlFor="confirmation-email" className="block text-sm font-semibold text-slate-700">Account email address
        <input id="confirmation-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} className="ir35-focus mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-950" />
      </label>
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">{notice}</p>}
      <button type="submit" disabled={pending || cooldown > 0} className="ir35-focus flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-60">
        {pending ? <Loader2 size={17} className="animate-spin" /> : <Mail size={17} />} Resend confirmation email
      </button>
      {cooldown > 0 && <p className="text-xs text-slate-600">You can request another link in {cooldown} seconds.</p>}
    </form>
  );
}
