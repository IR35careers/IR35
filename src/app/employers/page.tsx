import type { Metadata } from "next";
import { CheckCircle2, Database, MailCheck, ShieldCheck, Zap } from "lucide-react";
import { EmployerOnboardingForm } from "@/components/EmployerOnboardingForm";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";

export const metadata: Metadata = {
  title: "Free Employer Job Feed and Direct Applications",
  description: "Connect a public Greenhouse, Lever, Ashby or Workable careers board to IR35Careers at no charge and verify direct candidate application delivery.",
  alternates: { canonical: "/employers" },
};

const STEPS = [
  { icon: Database, title: "Add the public board", body: "Choose Greenhouse, Lever, Ashby or Workable and enter the identifier already used by your careers page." },
  { icon: MailCheck, title: "Confirm the recruitment inbox", body: "A 24-hour confirmation link proves where candidate-approved applications may be delivered." },
  { icon: Zap, title: "Receive relevant applications", body: "Published contract roles join the daily feed. Supported applications arrive with the candidate's approved CV and answers." },
] as const;

export default function EmployersPage() {
  return <div className="min-h-screen bg-slate-50 text-slate-950">
    <PublicHeader />
    <main>
      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,#d1fae5,transparent_42%),linear-gradient(to_bottom,#ffffff,#f8fafc)]">
        <div className="ir35-container grid gap-10 py-14 sm:py-18 lg:grid-cols-[0.92fr_1.08fr] lg:items-start lg:py-20">
          <div className="pt-2">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">For employers and recruitment agencies</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-[-0.05em] text-slate-950 sm:text-5xl lg:text-6xl">Publish contract roles and receive applications for free.</h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600">Connect your existing public careers board. There is no ATS password, paid integration or setup call. Your recruitment inbox confirms the request, then IR35Careers reviews the organisation and delivery destination before direct applications are enabled.</p>
            <a href="#connect" className="ir35-focus mt-6 inline-flex min-h-11 items-center rounded-xl bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800">Connect a job board free</a>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {["No subscription charge", "No candidate data before confirmation", "Daily UK contract refresh", "Candidate-approved application packets"].map((item) => <p key={item} className="flex items-center gap-2 text-sm font-semibold text-slate-700"><CheckCircle2 size={17} className="shrink-0 text-emerald-700" />{item}</p>)}
            </div>
            <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <p className="flex items-center gap-2 font-bold text-emerald-950"><ShieldCheck size={19} /> Employer-controlled delivery</p>
              <p className="mt-2 text-sm leading-6 text-emerald-900">Candidates review every CV, cover letter and answer before submission. New legal or personal questions pause for the candidate instead of being guessed.</p>
            </div>
          </div>
          <EmployerOnboardingForm />
        </div>
      </section>

      <section className="ir35-container py-14 sm:py-18">
        <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">How the free connection works</p><h2 className="mt-3 text-3xl font-bold tracking-[-0.04em] sm:text-4xl">Three checks protect the employer and candidate.</h2></div>
        <div className="mt-9 grid gap-5 lg:grid-cols-3">{STEPS.map((step, index) => <article key={step.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card"><div className="flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><step.icon size={21} /></span><span className="text-xs font-bold text-slate-400">0{index + 1}</span></div><h3 className="mt-5 text-lg font-bold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p></article>)}</div>
        <section className="mt-9 rounded-3xl bg-slate-950 p-7 text-white sm:p-9"><div className="grid gap-7 lg:grid-cols-2"><div><h2 className="text-2xl font-bold">What this connection does</h2><ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300"><li>Reads only jobs already published on the public careers board.</li><li>Keeps the original vacancy source and freshness evidence.</li><li>Filters for contract relevance and displays explicit IR35 evidence conservatively.</li><li>Delivers only applications the candidate has reviewed and submitted.</li></ul></div><div><h2 className="text-2xl font-bold">What it never requests</h2><ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300"><li>No ATS administrator password or private API key.</li><li>No access to existing applicants or employee records.</li><li>No automatic invention of candidate experience or screening answers.</li><li>No application delivery before the recruitment inbox confirms.</li></ul></div></div></section>
      </section>
    </main>
    <PublicFooter />
  </div>;
}
