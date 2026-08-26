import Link from "next/link";
import { ArrowRight, Check, CircleCheckBig, FileCheck2, MapPin, Search, Sparkles, WandSparkles } from "lucide-react";
import { AuthenticatedHomeRedirect } from "@/components/AuthenticatedHomeRedirect";
import { FeaturedJobs } from "@/components/FeaturedJobs";
import { HomeScrollProgress, HomeSourceRail, HomeStickyCta, Reveal } from "@/components/HomeMotion";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { buttonClassName } from "@/components/ui/button";

const JOURNEY = [
  ["01", "Discover", "Start with the contract, not the admin", "Compare IR35 evidence, rate, location and working pattern across fresh UK opportunities."],
  ["02", "Prepare", "Turn one Resume into a focused application", "Use verified experience to tailor the Resume, cover letter and reusable employer answers."],
  ["03", "Track", "Keep the receipt and every recruiter reply", "See exactly what was submitted and keep later employer messages connected to the role."],
] as const;

const GUIDES = [
  ["/blog/inside-vs-outside-ir35-contract-checks", "IR35 essentials", "Inside or outside: what changes?", "Understand status evidence, working practices and the questions worth asking before you apply."],
  ["/tools/take-home", "Free calculator", "Compare estimated take-home pay", "Model annual and monthly estimates for Inside and Outside IR35 engagements."],
  ["/tools/ir35-status", "Indicative checker", "Review the shape of an engagement", "Work through control, substitution and other important status signals in plain English."],
] as const;

const FAQS = [
  ["Can I browse before creating an account?", "Yes. Contract search and public guidance stay open. Create an account when you want to save, prepare or track an application."],
  ["Does IR35Careers invent Resume experience?", "No. Tailoring stays grounded in the experience and facts you approve in your contractor profile."],
  ["Will every employer form submit automatically?", "Compatible forms can be handled after approval. Security checks, employer-only accounts or missing facts pause with one clear action instead of hiding the problem."],
  ["How is IR35 status shown?", "Explicit Inside or Outside wording is shown as evidence. If a listing does not state a status, it remains unconfirmed rather than being guessed."],
] as const;

function SearchPanel() {
  return (
    <form action="/jobs" method="get" className="ir35-hero-search" aria-label="Search UK contracts">
      <label className="ir35-hero-search-field"><Search size={20} aria-hidden="true" /><span className="sr-only">Role, skill or company</span><input name="q" type="search" placeholder="Role, skill or company" /></label>
      <label className="ir35-hero-search-field"><MapPin size={20} aria-hidden="true" /><span className="sr-only">Town, city or UK</span><input name="location" type="search" placeholder="Town, city or UK" /></label>
      <button type="submit" className="ir35-focus inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-brand-700 px-6 text-sm font-bold text-white shadow-lg shadow-emerald-900/15 transition hover:-translate-y-0.5 hover:bg-brand-800">Search contracts <ArrowRight size={17} aria-hidden="true" /></button>
    </form>
  );
}

function ContractJourneyPreview() {
  return (
    <div className="ir35-product-browser ir35-product-browser-dark" aria-hidden="true">
      <div className="ir35-product-browser-bar"><span /><span /><span /><b>IR35Careers</b></div>
      <div className="ir35-product-dark-content">
        <p className="ir35-product-browser-label">Application progress</p><h3>DevOps Engineer</h3><p className="text-sm text-slate-400">Outside IR35 · Remote · £650/day</p>
        <div className="mt-7 space-y-3">
          {["Profile complete", "Resume tailored", "Application approved", "Employer confirmation"].map((label, index) => <div key={label} className={`ir35-product-step ${index < 3 ? "is-complete" : "is-active"}`}><span>{index < 3 ? <Check size={13} /> : <span className="ir35-pulse-dot" />}</span><p>{label}</p><small>{index < 3 ? "Done" : "Tracking"}</small></div>)}
        </div>
      </div>
    </div>
  );
}

function ResumePreview() {
  return (
    <div className="ir35-product-browser" aria-hidden="true">
      <div className="ir35-product-browser-bar"><span /><span /><span /><b>Resume workspace</b></div>
      <div className="ir35-resume-preview">
        <div className="ir35-resume-score"><strong>84%</strong><span>role match</span></div><p className="ir35-product-browser-label">Verified evidence</p><h3>Platform Engineer</h3>
        <div className="mt-5 flex flex-wrap gap-2">{["AWS", "Terraform", "Kubernetes", "CI/CD"].map((skill) => <span key={skill}>{skill}</span>)}</div>
        <div className="mt-6 space-y-2"><i className="w-full" /><i className="w-11/12" /><i className="w-4/5" /><i className="w-10/12" /></div>
      </div>
    </div>
  );
}

function TrackerPreview() {
  const rows = [["Cloud Engineer", "Submitted", "Today"], ["DevOps Consultant", "Interview", "Tomorrow"], ["Platform Engineer", "Needs you", "1 answer"]] as const;
  return (
    <div className="ir35-product-browser" aria-hidden="true">
      <div className="ir35-product-browser-bar"><span /><span /><span /><b>Application tracker</b></div>
      <div className="ir35-tracker-preview">{rows.map(([role, status, note], index) => <div key={role}><span className={`ir35-tracker-logo ir35-tracker-logo-${index + 1}`}>{role.slice(0, 1)}</span><p><strong>{role}</strong><small>{note}</small></p><em>{status}</em></div>)}</div>
    </div>
  );
}

export function HomeExperience() {
  return (
    <div className="ir35-public-canvas min-h-screen text-slate-950">
      <AuthenticatedHomeRedirect /><HomeScrollProgress /><PublicHeader />
      <main>
        <section className="ir35-home-hero relative isolate overflow-hidden border-b border-emerald-100/80">
          <div className="ir35-home-orb ir35-home-orb-one" aria-hidden="true" /><div className="ir35-home-orb ir35-home-orb-two" aria-hidden="true" />
          <div className="ir35-container relative grid min-h-[620px] grid-cols-[minmax(0,1fr)] items-center gap-12 py-12 sm:py-14 lg:min-h-[650px] lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:py-16">
            <Reveal className="min-w-0 max-w-3xl">
              <span className="ir35-home-pill"><span className="h-2 w-2 rounded-full bg-emerald-500" />Built for UK contractors</span>
              <h1 className="mt-6 max-w-[12ch] text-[clamp(2.35rem,4.2vw,4.35rem)] font-black leading-[0.95] tracking-[-0.052em] text-slate-950">One profile.<br /><span className="ir35-home-gradient-text">Better contracts.</span><br />Every reply connected.</h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">Find UK contract roles, prepare a focused Resume and keep applications, confirmations and recruiter messages in one place.</p>
              <div id="home-primary-actions" className="mt-8"><SearchPanel /></div>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold text-slate-600"><span>Popular:</span><Link href="/jobs?ir35=outside" className="ir35-focus rounded text-brand-700">Outside IR35</Link><Link href="/jobs?remote=true" className="ir35-focus rounded text-brand-700">Remote</Link><Link href="/jobs?min_rate=600" className="ir35-focus rounded text-brand-700">£600+/day</Link></div>
            </Reveal>
            <Reveal delay={0.1} distance={24} className="min-w-0">
              <div className="ir35-hero-proof">
                <div className="mb-4 flex items-center justify-between px-1"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Live product view</p><p className="mt-1 text-sm text-slate-600">Fresh roles with visible contract evidence</p></div><span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-500" />Live</span></div>
                <FeaturedJobs />
                <div className="mt-4 grid grid-cols-3 gap-3">{[["2,500+", "live roles"], ["3", "apply modes"], ["1", "clear tracker"]].map(([value, label]) => <div key={label} className="rounded-2xl border border-white/70 bg-white/70 px-3 py-4 text-center backdrop-blur"><strong className="block text-xl text-slate-950">{value}</strong><span className="text-[11px] font-semibold text-slate-500">{label}</span></div>)}</div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white py-7"><div className="ir35-container"><HomeSourceRail /></div></section>

        <section className="ir35-product-story py-14 sm:py-16 lg:py-20">
          <div className="ir35-container">
            <Reveal className="mx-auto max-w-4xl text-center"><p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">See the whole journey</p><h2 className="mt-4 text-4xl font-black tracking-[-0.055em] text-slate-950 sm:text-6xl">From the first match to the recruiter reply.</h2><p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">A connected contractor workspace that shows the product working before asking you to create an account.</p></Reveal>
            <div className="mt-12 grid gap-5 lg:grid-cols-12">
              <Reveal className="lg:col-span-7" distance={18}><article className="ir35-showcase-card ir35-showcase-card-mint"><span className="ir35-showcase-number">01</span><div className="max-w-lg"><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-900/70">Live opportunity proof</p><h3 className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950 sm:text-4xl">Find the right contract while the important details stay visible.</h3><p className="mt-4 leading-7 text-slate-700">Search by role, IR35 evidence, rate and working pattern. Unconfirmed status stays unconfirmed.</p></div><div className="mt-8"><ContractJourneyPreview /></div></article></Reveal>
              <Reveal className="lg:col-span-5" delay={0.08} distance={18}><article className="ir35-showcase-card ir35-showcase-card-violet"><span className="ir35-showcase-number">02</span><p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-900/70">Evidence-led preparation</p><h3 className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950">Tailor the Resume without inventing experience.</h3><p className="mt-4 leading-7 text-slate-700">Role keywords strengthen structure and relevance while your approved evidence remains the source of truth.</p><div className="mt-8"><ResumePreview /></div></article></Reveal>
              <Reveal className="lg:col-span-5" distance={18}><article className="ir35-showcase-card ir35-showcase-card-sky"><span className="ir35-showcase-number">03</span><p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-900/70">One readable tracker</p><h3 className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950">Know what happened after Apply.</h3><p className="mt-4 leading-7 text-slate-700">Confirmation, interview, action needed and rejection messages stay linked to the contract that created them.</p><div className="mt-8"><TrackerPreview /></div></article></Reveal>
              <Reveal className="lg:col-span-7" delay={0.08} distance={18}><article className="ir35-showcase-card bg-[#071426] text-white"><span className="ir35-showcase-number border-white/15 bg-white/10 text-white">04</span><div className="grid h-full gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">Control stays with you</p><h3 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">Automatic when compatible. Clear when attention is genuinely needed.</h3><p className="mt-4 leading-7 text-slate-300">Choose Automatic, Guided or Review mode. Security controls are never hidden or bypassed.</p></div><div className="grid gap-3">{[[Sparkles, "Automatic", "Compatible forms run after approval"], [WandSparkles, "Guided", "Strong matches move first"], [FileCheck2, "Review", "Approve each final packet"]].map(([Icon, title, body]) => { const ModeIcon = Icon as typeof Sparkles; return <div key={String(title)} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"><span className="rounded-xl bg-emerald-300/15 p-2 text-emerald-300"><ModeIcon size={18} /></span><p><strong className="block text-sm">{String(title)}</strong><span className="text-xs leading-5 text-slate-400">{String(body)}</span></p></div>; })}</div></div></article></Reveal>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white py-14 sm:py-16 lg:py-20"><div className="ir35-container"><Reveal className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">A simple contractor workflow</p><h2 className="mt-4 text-4xl font-black tracking-[-0.05em] text-slate-950 sm:text-5xl">Prepare once. Keep every application connected.</h2></Reveal><div className="mt-9 grid gap-4 lg:grid-cols-3">{JOURNEY.map(([number, label, title, body], index) => <Reveal key={number} delay={index * 0.07} distance={16}><article className="group h-full rounded-3xl border border-slate-200 bg-slate-50 p-6 transition-[transform,box-shadow,border-color] hover:-translate-y-1 hover:border-emerald-200 hover:shadow-floating sm:p-7"><div className="flex items-center justify-between"><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">{label}</span><span className="text-sm font-black text-slate-300">{number}</span></div><h3 className="mt-8 text-2xl font-black tracking-[-0.03em] text-slate-950">{title}</h3><p className="mt-4 text-sm leading-6 text-slate-600">{body}</p></article></Reveal>)}</div></div></section>

        <section className="border-b border-emerald-100 bg-[#eef7f3] py-14 sm:py-16"><div className="ir35-container"><div className="grid items-end gap-5 lg:grid-cols-[1fr_auto]"><Reveal className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Understand before you apply</p><h2 className="mt-3 text-3xl font-black tracking-[-0.045em] text-slate-950 sm:text-5xl">Practical guidance beside the work.</h2></Reveal><Reveal delay={0.06}><Link href="/blog" className={buttonClassName({ variant: "secondary", className: "hidden lg:inline-flex" })}>Browse contractor guides <ArrowRight size={15} /></Link></Reveal></div><div className="mt-8 grid gap-4 md:grid-cols-3">{GUIDES.map(([href, eyebrow, title, body], index) => <Reveal key={href} delay={index * 0.07} distance={16}><Link href={href} className="ir35-focus group flex min-h-[220px] flex-col rounded-3xl border border-white bg-white/90 p-6 shadow-card transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-floating"><span className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">{eyebrow}</span><h3 className="mt-4 text-xl font-black tracking-[-0.025em] text-slate-950">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{body}</p><span className="mt-auto pt-6 text-sm font-bold text-brand-700">Open <ArrowRight className="inline transition-transform group-hover:translate-x-1" size={14} /></span></Link></Reveal>)}</div></div></section>

        <section className="bg-white py-14 sm:py-16 lg:py-20"><div className="ir35-container grid gap-8 lg:grid-cols-[0.72fr_1.28fr]"><Reveal><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Frequently asked</p><h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950 sm:text-4xl">The important questions, answered plainly.</h2><p className="mt-4 text-sm leading-6 text-slate-600">Clear product states mean you can see what happened and what comes next.</p></Reveal><Reveal delay={0.08} className="divide-y divide-slate-200 rounded-3xl border border-slate-200 bg-slate-50/80 px-5 shadow-card sm:px-7">{FAQS.map(([question, answer], index) => <details key={question} className="group py-5" open={index === 0}><summary className="ir35-focus flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg text-base font-bold text-slate-950 marker:content-none"><span>{question}</span><span className="text-xl text-brand-700 transition-transform group-open:rotate-45">+</span></summary><p className="pb-1 pr-8 text-sm leading-6 text-slate-600">{answer}</p></details>)}</Reveal></div></section>

        <section className="ir35-home-cta relative overflow-hidden py-12 text-white sm:py-14"><div className="ir35-container relative grid items-center gap-8 lg:grid-cols-[1fr_auto]"><Reveal><p className="text-sm font-bold text-emerald-300">Your next contract, with the important details visible.</p><h2 className="mt-3 max-w-3xl text-3xl font-black tracking-[-0.04em] sm:text-5xl">Browse first. Build your profile when you are ready to apply.</h2><ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-300">{["Free to browse", "Original source retained", "One connected tracker"].map((item) => <li key={item} className="flex items-center gap-2"><CircleCheckBig size={15} className="text-emerald-300" />{item}</li>)}</ul></Reveal><Reveal delay={0.1} className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row"><Link href="/jobs" className={buttonClassName({ variant: "secondary", size: "lg", className: "border-white bg-white text-slate-950 hover:bg-emerald-50" })}>Browse contracts <ArrowRight size={16} /></Link><Link href="/account?mode=create&next=%2Fdashboard" prefetch={false} className={buttonClassName({ variant: "accent", size: "lg" })}>Create free account</Link></Reveal></div></section>
      </main>
      <PublicFooter /><HomeStickyCta />
    </div>
  );
}
