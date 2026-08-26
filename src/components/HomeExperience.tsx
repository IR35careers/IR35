import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  BookOpen,
  BriefcaseBusiness,
  Calculator,
  Check,
  ClipboardCheck,
  FileCheck2,
  Gauge,
  Inbox,
  ListChecks,
  MapPin,
  Search,
  ShieldCheck,
} from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { FeaturedJobs } from "@/components/FeaturedJobs";
import { buttonClassName } from "@/components/ui/button";
import { AuthenticatedHomeRedirect } from "@/components/AuthenticatedHomeRedirect";
import { HomeScrollProgress, Reveal } from "@/components/HomeMotion";

const PRINCIPLES = [
  {
    icon: ShieldCheck,
    title: "IR35 evidence, not guesswork",
    body: "See whether a status was stated in the title or listing, or whether it still needs confirmation.",
    tone: "border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-teal-50",
    iconTone: "bg-emerald-600 text-white shadow-emerald-900/15",
  },
  {
    icon: Gauge,
    title: "Rates and working pattern up front",
    body: "Compare day rates, location and remote, hybrid or on-site expectations before opening a role.",
    tone: "border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50",
    iconTone: "bg-amber-500 text-slate-950 shadow-amber-900/15",
  },
  {
    icon: BellRing,
    title: "Save the search, not the admin",
    body: "Create focused alerts and keep promising contracts together once you sign in.",
    tone: "border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-cyan-50",
    iconTone: "bg-sky-600 text-white shadow-sky-900/15",
  },
] as const;

const GUIDE_CARDS = [
  {
    href: "/resources",
    eyebrow: "IR35 essentials",
    title: "Inside or outside: what actually changes?",
    body: "A plain-English guide to status, working practices and the practical questions to ask.",
  },
  {
    href: "/tools/take-home",
    eyebrow: "Free calculator",
    title: "Compare estimated take-home pay",
    body: "Model an Inside and Outside IR35 engagement using current 2026/27 assumptions.",
  },
  {
    href: "/tools/ir35-status",
    eyebrow: "Indicative checker",
    title: "Review the shape of an engagement",
    body: "Work through control, substitution and other signals before seeking a professional view.",
  },
] as const;

const WORKFLOW = [
  { icon: Search, title: "Discover", body: "Filter UK contracts by IR35 status, rate, skill and working pattern.", href: "/jobs" },
  { icon: FileCheck2, title: "Understand", body: "Review status evidence, match factors and gaps before investing time.", href: "/analyse-job" },
  { icon: ClipboardCheck, title: "Prepare", body: "Tailor the Resume, draft a grounded letter and approve every screening answer.", href: "/applications" },
  { icon: ListChecks, title: "Track", body: "Move applications through a readable pipeline without drag-and-drop.", href: "/applications" },
  { icon: Inbox, title: "Respond", body: "Keep recruiter messages linked to the contract that generated them.", href: "/inbox" },
] as const;

const FAQS = [
  ["How does IR35Careers find contracts?", "Authorised job-board APIs and public employer ATS feeds are normalised, deduplicated and refreshed. Every result keeps its original source link and last-seen evidence."],
  ["Does an Outside IR35 label guarantee the status?", "No. The label reports what the advert explicitly says. The client determination and the real working practices still matter, so TBC is shown when no clear status was found."],
  ["Will Resume Studio invent skills or achievements?", "No. Missing terms remain gaps. A new skill is added only after you confirm that you genuinely have it, and every suggested edit remains visible and editable."],
  ["Can I apply without leaving IR35Careers?", "Yes for supported public employer forms. Review the tailored application once and choose Apply now. If an employer asks for a sign-in, verification or a new personal answer, the application pauses and tells you what needs attention."],
  ["Can I export or delete my information?", "Yes. Signed-in users can download a portable account export and permanently delete their account and private Resume files from Settings."],
  ["Is there a paid plan?", "The current public beta is free. Any future paid plan will show its benefits, full price and renewal terms before you choose it."],
] as const;

export function HomeExperience() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f6f8f7] text-slate-950">
      <AuthenticatedHomeRedirect />
      <HomeScrollProgress />
      <PublicHeader />

      <main>
        <section className="ir35-home-hero relative isolate overflow-hidden border-b border-emerald-100/80">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
            <div className="ir35-home-grid absolute inset-0 opacity-55" />
            <div className="ir35-home-orbit absolute -right-24 -top-56 h-[560px] w-[560px] rounded-full border-[94px] border-emerald-100/50" />
            <div className="absolute -left-40 bottom-[-400px] h-[520px] w-[520px] rounded-full bg-emerald-100/40 blur-2xl" />
            <div className="absolute left-[44%] top-8 h-48 w-48 rounded-full bg-cyan-100/40 blur-3xl" />
          </div>

          <div className="ir35-container grid items-center gap-9 py-10 sm:py-14 lg:min-h-[590px] lg:grid-cols-[1.04fr_0.96fr] lg:gap-14 lg:py-16">
            <Reveal className="min-w-0" distance={16}>
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-emerald-200 bg-white/90 px-3 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" /> Open public beta for UK contractors
              </span>
              <h1 className="mt-6 max-w-[760px] text-[2.55rem] font-semibold leading-[0.99] tracking-[-0.06em] text-slate-950 sm:text-[3.7rem] lg:text-[4.35rem]">
                Contract work, without the <span className="text-brand-600">IR35 guesswork.</span>
              </h1>
              <p className="ir35-reading-measure mt-5 max-w-[600px] text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
                Find UK contracts, tailor your Resume for each role and keep every application in one clear workspace.
              </p>

              <form action="/jobs" method="get" className="mt-7 rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-[0_20px_60px_-38px_rgba(6,95,70,0.42)] backdrop-blur" role="search">
                <div className="grid gap-2 sm:grid-cols-[1fr_0.75fr_auto]">
                  <label className="relative block">
                    <span className="sr-only">Role, skill or company</span>
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
                    <input
                      type="search"
                      name="q"
                      placeholder="Role, skill or company"
                      className="ir35-focus min-h-12 w-full rounded-xl border border-transparent bg-[#f7f8f6] pl-11 pr-4 text-sm text-slate-950 placeholder:text-slate-500 hover:bg-slate-100"
                    />
                  </label>
                  <label className="relative block sm:border-l sm:border-slate-200 sm:pl-2">
                    <span className="sr-only">Location</span>
                    <MapPin className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 sm:left-5" size={18} aria-hidden="true" />
                    <input
                      type="search"
                      name="location"
                      placeholder="Town, city or UK"
                      className="ir35-focus min-h-12 w-full rounded-xl border border-transparent bg-[#f7f8f6] pl-11 pr-4 text-sm text-slate-950 placeholder:text-slate-500 hover:bg-slate-100 sm:pl-12"
                    />
                  </label>
                  <button type="submit" className={buttonClassName({ size: "lg", className: "w-full sm:w-auto" })}>
                    Search contracts <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </form>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="text-slate-500">Explore</span>
                <Link href="/ir35-careers" className="ir35-focus rounded font-semibold text-brand-700 hover:text-brand-800">IR35 careers</Link>
                <Link href="/jobs?ir35=outside" className="ir35-focus rounded font-semibold text-brand-700 hover:text-brand-800">Outside IR35</Link>
                <Link href="/jobs?remote=remote" className="ir35-focus rounded font-semibold text-brand-700 hover:text-brand-800">Remote</Link>
                <Link href="/jobs?min_rate=600" className="ir35-focus rounded font-semibold text-brand-700 hover:text-brand-800">£600+/day</Link>
              </div>
            </Reveal>

            <Reveal className="min-w-0" delay={0.12} distance={24}>
              <FeaturedJobs />
            </Reveal>
          </div>
        </section>

        <section className="relative z-10 border-b border-slate-200/80 bg-white/90">
          <div className="ir35-container grid gap-px overflow-hidden bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [FileCheck2, "Status evidence", "Know what the listing states"],
              [BriefcaseBusiness, "Contract-only focus", "Confirmed Inside and Outside roles"],
              [Calculator, "Free contractor tools", "Model status and take-home"],
              [BookOpen, "Plain-English guidance", "Primary sources, clear caveats"],
            ].map(([Icon, title, body]) => {
              const Visual = Icon as typeof ShieldCheck;
              return (
                <div key={String(title)} className="flex items-start gap-3 bg-white px-5 py-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Visual size={17} aria-hidden="true" /></span>
                  <div><p className="text-sm font-semibold text-slate-950">{String(title)}</p><p className="mt-0.5 text-xs text-slate-600">{String(body)}</p></div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="ir35-home-surface py-12 sm:py-14 lg:py-16">
          <div className="ir35-container">
            <div className="grid items-end gap-5 lg:grid-cols-[1fr_auto]">
              <Reveal className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">A clearer contractor search</p>
                <h2 className="mt-3 text-3xl font-bold tracking-[-0.045em] text-slate-950 sm:text-4xl">Compare what matters before you apply.</h2>
                <p className="mt-3 text-base leading-7 text-slate-600">Status, rate and working pattern stay visible, so promising contracts are easier to recognise.</p>
              </Reveal>
              <Reveal delay={0.06}>
                <Link href="/jobs" className={buttonClassName({ variant: "secondary", className: "hidden lg:inline-flex" })}>Explore contracts <ArrowRight size={15} /></Link>
              </Reveal>
            </div>
            <div className="mt-7 grid gap-4 lg:grid-cols-3">
              {PRINCIPLES.map((item, index) => (
                <Reveal key={item.title} delay={index * 0.07} distance={18}>
                  <article className={`ir35-home-principle ir35-card min-h-[205px] border p-6 sm:p-7 ${item.tone}`}>
                    <div className="flex items-center justify-between">
                      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg ${item.iconTone}`}><item.icon size={20} aria-hidden="true" /></span>
                      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">0{index + 1}</span>
                    </div>
                    <h3 className="mt-5 text-xl font-semibold tracking-[-0.025em] text-slate-950">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
            <Link href="/jobs" className={buttonClassName({ variant: "secondary", className: "mt-6 w-full lg:hidden" })}>Explore contracts <ArrowRight size={15} /></Link>
          </div>
        </section>

        <section className="ir35-home-dark relative overflow-hidden border-y border-slate-800 py-12 text-white sm:py-14 lg:py-16">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -right-32 top-1/2 h-96 w-96 -translate-y-1/2 rounded-full border-[80px] border-emerald-400/[0.05]" />
          </div>
          <div className="ir35-container relative">
            <div className="grid items-end gap-5 lg:grid-cols-[1fr_0.7fr]">
              <Reveal className="max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">One connected workspace</p>
                <h2 className="mt-3 text-3xl font-bold tracking-[-0.045em] sm:text-4xl">From discovery to recruiter reply.</h2>
              </Reveal>
              <Reveal delay={0.06}>
                <p className="text-sm leading-6 text-slate-300 lg:text-right">Prepare reviewed application materials, keep confirmations and follow every response without losing the original role.</p>
              </Reveal>
            </div>
            <div className="relative mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {WORKFLOW.map((step, index) => (
                <Reveal key={step.title} delay={index * 0.055} distance={16}>
                  <Link href={step.href} className="ir35-focus group flex min-h-[200px] flex-col rounded-2xl border border-white/10 bg-white/[0.045] p-5 transition-[border-color,background-color,transform] hover:-translate-y-1 hover:border-emerald-300/40 hover:bg-white/[0.08]">
                    <div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-300"><step.icon size={19} /></span><span className="text-xs font-bold text-slate-400">0{index + 1}</span></div>
                    <h3 className="mt-5 font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{step.body}</p>
                    <span className="mt-auto inline-flex items-center gap-1 pt-5 text-sm font-semibold text-emerald-300">Open <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-emerald-100 bg-[#eef7f3] py-12 sm:py-14 lg:py-16">
          <div className="ir35-container">
            <div className="grid items-end gap-5 lg:grid-cols-[1fr_auto]">
              <Reveal className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">Understand before you apply</p>
                <h2 className="mt-3 text-3xl font-bold tracking-[-0.045em] text-slate-950 sm:text-4xl">Practical guidance beside the work.</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">Use clear educational tools to ask better questions, then seek professional advice when the engagement needs it.</p>
              </Reveal>
              <Reveal delay={0.06}>
                <Link href="/resources" className={buttonClassName({ variant: "secondary", className: "hidden lg:inline-flex" })}>Browse all resources <ArrowRight size={15} aria-hidden="true" /></Link>
              </Reveal>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-3">
              {GUIDE_CARDS.map((guide, index) => (
                <Reveal key={guide.href} delay={index * 0.07} distance={16}>
                  <Link href={guide.href} className="ir35-focus group flex min-h-[220px] flex-col rounded-2xl border border-white bg-white/90 p-6 shadow-card backdrop-blur-sm transition-[transform,box-shadow,border-color] hover:-translate-y-1 hover:border-emerald-200 hover:shadow-floating">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-700">{guide.eyebrow}</span>
                    <h3 className="mt-4 text-lg font-semibold leading-6 text-slate-950">{guide.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{guide.body}</p>
                    <span className="mt-auto pt-6 text-sm font-semibold text-brand-700">Open <ArrowRight className="inline transition-transform group-hover:translate-x-1" size={14} aria-hidden="true" /></span>
                  </Link>
                </Reveal>
              ))}
            </div>
            <Link href="/resources" className={buttonClassName({ variant: "secondary", className: "mt-6 w-full lg:hidden" })}>Browse all resources <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white py-12 sm:py-14 lg:py-16">
          <div className="ir35-container grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">Frequently asked</p>
              <h2 className="mt-3 text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-4xl">The important questions, answered plainly.</h2>
              <p className="mt-4 text-sm leading-6 text-slate-600">Product state and safety gates are published so a contractor never has to guess what happened.</p>
              <Link href="/pricing" className={buttonClassName({ variant: "secondary", className: "mt-6" })}>View current access <ArrowRight size={15} /></Link>
            </Reveal>
            <Reveal delay={0.08} className="divide-y divide-slate-200 rounded-3xl border border-slate-200 bg-slate-50/80 px-5 shadow-card sm:px-7">
              {FAQS.map(([question, answer], index) => (
                <details key={question} className="group py-5" open={index === 0}>
                  <summary className="ir35-focus flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg text-base font-bold text-slate-950 marker:content-none">
                    <span>{question}</span><span className="text-xl text-brand-700 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="pb-1 pr-8 text-sm leading-6 text-slate-600">{answer}</p>
                </details>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="ir35-home-cta relative overflow-hidden py-10 text-white sm:py-12">
          <div className="ir35-container relative grid items-center gap-8 lg:grid-cols-[1fr_auto]">
            <Reveal>
              <p className="text-sm font-semibold text-emerald-300">Your next contract, with the important details visible.</p>
              <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-[-0.035em] sm:text-4xl">Start with the role. Create an account only when you want to save the search.</h2>
              <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-300">
                {["Free to browse", "Original source links", "No application submitted without you"].map((item) => <li key={item} className="flex items-center gap-2"><Check size={15} className="text-emerald-300" aria-hidden="true" />{item}</li>)}
              </ul>
            </Reveal>
            <Reveal delay={0.1} className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
              <Link href="/jobs" className={buttonClassName({ variant: "secondary", size: "lg", className: "border-white bg-white text-slate-950 hover:bg-emerald-50" })}>Browse contracts <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/account?mode=create&next=%2Fdashboard" prefetch={false} className={buttonClassName({ variant: "accent", size: "lg" })}>Join the public beta</Link>
            </Reveal>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
