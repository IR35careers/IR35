"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Send, ShieldCheck } from "lucide-react";

const PROVIDERS = {
  greenhouse: { label: "Greenhouse", example: "boards.greenhouse.io/company-name" },
  lever: { label: "Lever", example: "jobs.lever.co/company-name" },
  ashby: { label: "Ashby", example: "jobs.ashbyhq.com/company-name" },
  workable: { label: "Workable", example: "apply.workable.com/company-name" },
  smartrecruiters: { label: "SmartRecruiters", example: "jobs.smartrecruiters.com/company-name" },
} as const;

type Provider = keyof typeof PROVIDERS;

const fieldClass = "ir35-focus mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-950 shadow-sm placeholder:text-slate-400";

export function EmployerOnboardingForm() {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [recruitmentEmail, setRecruitmentEmail] = useState("");
  const [type, setType] = useState<Provider>("greenhouse");
  const [slug, setSlug] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ message: string; jobs: number } | null>(null);
  const sourcePreview = useMemo(() => PROVIDERS[type].example.replace("company-name", slug.trim().toLowerCase() || "company-name"), [slug, type]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess(null);
    try {
      const response = await fetch("/api/employers/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, contactName, recruitmentEmail, type, slug, consent, website }),
      });
      const json = await response.json() as { error?: string; message?: string; publishedJobsFound?: number };
      if (!response.ok) throw new Error(json.error || "Unable to start the connection.");
      setSuccess({ message: json.message || "Verification sent.", jobs: json.publishedJobsFound ?? 0 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start the connection.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return <section id="connect" className="scroll-mt-24 rounded-3xl border border-emerald-200 bg-white p-6 shadow-card sm:p-8" aria-live="polite">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800"><CheckCircle2 size={24} /></span>
      <h2 className="mt-5 text-2xl font-bold text-slate-950">Check the recruitment inbox</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{success.message}</p>
      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-950">Public board verified</p>
        <p className="mt-1 text-sm text-slate-600">{success.jobs} currently published job{success.jobs === 1 ? "" : "s"} found. Contract roles enter the next scheduled refresh after the email link is confirmed. Direct delivery activates only after the authority review.</p>
      </div>
      <button type="button" onClick={() => setSuccess(null)} className="ir35-focus mt-6 inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">Connect another board</button>
    </section>;
  }

  return <form id="connect" onSubmit={submit} className="scroll-mt-24 rounded-3xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
    <div className="flex items-start gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><ShieldCheck size={21} /></span>
      <div><h2 className="text-xl font-bold text-slate-950">Connect your public careers board</h2><p className="mt-1 text-sm leading-6 text-slate-600">No subscription and no API key. We verify the public board first, then verify your recruitment inbox.</p></div>
    </div>

    <div className="mt-7 grid gap-5 sm:grid-cols-2">
      <label className="block text-sm font-semibold text-slate-800">Employer or agency name<input required minLength={2} maxLength={100} value={companyName} onChange={(event) => setCompanyName(event.target.value)} className={fieldClass} autoComplete="organization" placeholder="Example Recruitment" /></label>
      <label className="block text-sm font-semibold text-slate-800">Your name<input required minLength={2} maxLength={100} value={contactName} onChange={(event) => setContactName(event.target.value)} className={fieldClass} autoComplete="name" placeholder="Your full name" /></label>
      <label className="block text-sm font-semibold text-slate-800 sm:col-span-2">Recruitment email<input required type="email" maxLength={254} value={recruitmentEmail} onChange={(event) => setRecruitmentEmail(event.target.value)} className={fieldClass} autoComplete="email" placeholder="recruitment@company.co.uk" /><span className="mt-2 block text-xs font-normal leading-5 text-slate-500">The confirmation link is sent here. Candidate information cannot be delivered until this inbox confirms.</span></label>
      <label className="block text-sm font-semibold text-slate-800">Careers platform<select value={type} onChange={(event) => setType(event.target.value as Provider)} className={fieldClass}>{Object.entries(PROVIDERS).map(([value, provider]) => <option key={value} value={value}>{provider.label}</option>)}</select></label>
      <label className="block text-sm font-semibold text-slate-800">Board identifier<input required pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}" maxLength={100} value={slug} onChange={(event) => setSlug(event.target.value)} className={fieldClass} autoComplete="off" placeholder="company-name" /></label>
    </div>

    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Board we will verify</p>
      <p className="mt-1 break-all font-mono text-xs text-slate-700">https://{sourcePreview}</p>
    </div>

    <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label></div>

    <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4 text-sm leading-6 text-slate-700"><input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-emerald-700" /><span>I am authorised to connect this careers board and recruitment inbox. I agree to the <Link href="/terms" className="font-semibold text-brand-700 underline">Terms of use</Link> and have read the <Link href="/privacy" className="font-semibold text-brand-700 underline">Privacy Notice</Link>.</span></label>

    {error && <p role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}
    <button disabled={submitting} type="submit" className="ir35-focus mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white transition hover:bg-brand-800 disabled:cursor-wait disabled:opacity-65">{submitting ? <><Loader2 size={17} className="animate-spin" /> Verifying public board</> : <><Send size={17} /> Send verification email</>}</button>
    <p className="mt-3 text-center text-xs leading-5 text-slate-500">Protected by request limits and email confirmation. IR35Careers never asks for your ATS password.</p>
  </form>;
}
