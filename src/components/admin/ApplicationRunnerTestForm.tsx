"use client";

import { useState, type FormEvent } from "react";

export function ApplicationRunnerTestForm() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  if (step === 3) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-5 py-12">
        <section className="w-full rounded-3xl border border-emerald-200 bg-white p-8 shadow-card">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Controlled test portal</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Thank you for applying</h1>
          <p className="mt-4 text-base leading-7 text-slate-700">Your application has been received.</p>
        </section>
      </main>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStep(3);
  };

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <header className="mb-7">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Controlled test portal</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Platform Engineer test application</h1>
        <p className="mt-2 text-sm text-slate-600">Step {step} of 2</p>
      </header>

      {step === 1 ? (
        <form onSubmit={(event) => { event.preventDefault(); setStep(2); }} className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-900">First name<input name="first_name" required className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label>
            <label className="text-sm font-semibold text-slate-900">Last name<input name="last_name" required className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label>
            <label className="text-sm font-semibold text-slate-900">Email address<input name="email" type="email" required className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label>
            <label className="text-sm font-semibold text-slate-900">Phone number<input name="phone" type="tel" required className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label>
          </div>
          <label className="block text-sm font-semibold text-slate-900">Are you authorised to work in the UK?<select name="work_authorisation" required defaultValue="" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"><option value="" disabled>Select an answer</option><option>Yes</option><option>No</option></select></label>
          <label className="block text-sm font-semibold text-slate-900">Upload your CV<input name="resume" type="file" accept="application/pdf" required className="mt-2 block w-full rounded-xl border border-slate-300 p-3 font-normal" /></label>
          <button type="submit" className="min-h-11 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white">Next</button>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
          <label className="block text-sm font-semibold text-slate-900">Cover letter<textarea name="cover_letter" required rows={8} className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal" /></label>
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">Do you need visa sponsorship?</legend>
            <div className="mt-3 flex gap-5">
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="sponsorship" value="Yes" required /> Yes</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="sponsorship" value="No" required /> No</label>
            </div>
          </fieldset>
          <label className="flex items-start gap-3 text-sm leading-6 text-slate-700"><input type="checkbox" name="privacy_consent" required className="mt-1" /> <span>I agree to the privacy notice</span></label>
          <button type="submit" className="min-h-11 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white">Submit application</button>
        </form>
      )}
    </main>
  );
}
