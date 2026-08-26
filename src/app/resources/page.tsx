import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ExternalLink,
  Landmark,
  Scale,
} from "lucide-react";
import { HomeScrollProgress } from "@/components/HomeMotion";
import { Reveal } from "@/components/HomeReveal";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { buttonClassName } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "IR35 Guides for UK Contractors",
  description:
    "Plain-English IR35 guidance for UK contractors, including inside and outside IR35, status decisions, umbrella companies and limited companies.",
  alternates: { canonical: "/resources" },
};

const GUIDES = [
  {
    id: "what-is-ir35",
    number: "01",
    icon: BookOpen,
    label: "Start here",
    title: "What IR35 means",
    summary: "Understand the off-payroll working rules and why the status of an engagement matters.",
    body:
      "IR35, also known as the off-payroll working rules, considers whether a contractor is genuinely self-employed or would be treated as an employee for tax purposes. An inside IR35 engagement is generally taxed through PAYE. An outside IR35 engagement may be delivered through your own limited company, subject to the facts of the working arrangement.",
  },
  {
    id: "inside-outside",
    number: "02",
    icon: Scale,
    label: "Compare status",
    title: "Inside and outside IR35",
    summary: "See how the status can affect working arrangements, administration and take-home pay.",
    body:
      "Inside IR35 usually means income tax and National Insurance are deducted through PAYE, often by an umbrella company. Outside IR35 indicates that the engagement reflects an independent business relationship. Status should not be judged from the role title alone, and a higher day rate does not automatically make one arrangement better than another.",
  },
  {
    id: "status-decision",
    number: "03",
    icon: Landmark,
    label: "Review the evidence",
    title: "How status is decided",
    summary: "Learn the working-practice factors behind a status determination before accepting a role.",
    body:
      "The real working relationship matters as much as the written contract. Important factors include the client's level of control, whether a genuine right of substitution exists, mutuality of obligation, financial risk, equipment and whether the contractor operates as an independent business. The evidence needs to be considered together rather than as a simple keyword test.",
  },
  {
    id: "working-models",
    number: "04",
    icon: Building2,
    label: "Choose a route",
    title: "Umbrella and limited company working",
    summary: "Compare the common ways contractors are engaged after the IR35 position is known.",
    body:
      "Inside IR35 contractors often work through an umbrella company that employs them and operates PAYE. Outside IR35 engagements are commonly delivered through a contractor's limited company, bringing additional accounting and company responsibilities. The appropriate route depends on the engagement, its status and your circumstances.",
  },
] as const;

const CHECKPOINTS = [
  "Is the IR35 status stated clearly?",
  "What working practices support that status?",
  "Does the rate make sense after tax and costs?",
] as const;

export default function ResourcesPage() {
  return (
    <div className="min-h-screen bg-[#f7faf8] text-slate-950">
      <HomeScrollProgress />
      <PublicHeader />

      <main>
        <section className="ir35-home-hero relative overflow-hidden border-b border-slate-200">
          <div aria-hidden="true" className="absolute -right-24 top-10 h-80 w-80 rounded-full border-[54px] border-emerald-100/60" />
          <div aria-hidden="true" className="absolute -left-24 bottom-[-9rem] h-64 w-64 rounded-full bg-teal-100/50 blur-3xl" />
          <div className="ir35-container relative grid gap-10 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.75fr] lg:items-end lg:py-24">
            <Reveal>
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800 shadow-sm backdrop-blur">
                  <BookOpen size={15} aria-hidden="true" />
                  IR35 guides
                </div>
                <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.02] tracking-[-0.055em] sm:text-5xl lg:text-6xl">
                  Understand the contract before you commit.
                </h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                  Clear guidance for contractors who want to understand IR35 status, working models and the questions worth asking before accepting an engagement.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.12}>
              <aside className="rounded-[28px] border border-emerald-200/80 bg-white/90 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur sm:p-7">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Before you accept</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight">Three useful checkpoints</h2>
                <ul className="mt-5 space-y-4">
                  {CHECKPOINTS.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                      <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </aside>
            </Reveal>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white py-12 sm:py-16">
          <div className="ir35-container">
            <Reveal>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Guidance library</p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Choose what you need to understand.</h2>
                </div>
                <p className="max-w-md text-sm leading-6 text-slate-600">Read in order for a practical introduction, or go directly to the topic relevant to your next contract.</p>
              </div>
            </Reveal>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {GUIDES.map((guide, index) => (
                <Reveal key={guide.id} delay={index * 0.06}>
                  <Link
                    href={`#${guide.id}`}
                    className="ir35-card ir35-home-principle group flex min-h-[210px] flex-col p-6 sm:p-7"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                        <guide.icon size={21} aria-hidden="true" />
                      </div>
                      <span className="text-xs font-semibold tracking-[0.16em] text-slate-400">{guide.number}</span>
                    </div>
                    <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">{guide.label}</p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{guide.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{guide.summary}</p>
                    <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
                      Read guide <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
                    </span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="ir35-home-surface py-12 sm:py-20 lg:py-24">
          <div className="ir35-container grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)] lg:items-start">
            <Reveal className="lg:sticky lg:top-28">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">In this guide</p>
                <nav aria-label="Guide contents" className="mt-4 space-y-1">
                  {GUIDES.map((guide) => (
                    <Link key={guide.id} href={`#${guide.id}`} className="ir35-focus flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-emerald-50 hover:text-emerald-800">
                      <span className="text-xs text-slate-400">{guide.number}</span>
                      {guide.title}
                    </Link>
                  ))}
                </nav>
              </div>
            </Reveal>

            <div className="space-y-5">
              {GUIDES.map((guide, index) => (
                <Reveal key={guide.id} delay={index * 0.04}>
                  <article id={guide.id} className="scroll-mt-28 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:p-10">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                        <guide.icon size={21} aria-hidden="true" />
                      </div>
                      <div>
                        <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">
                          <span>{guide.number}</span>
                          <span className="h-px w-8 bg-emerald-300" />
                          <span>{guide.label}</span>
                        </div>
                        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-3xl">{guide.title}</h2>
                        <p className="mt-4 max-w-4xl text-base leading-8 text-slate-600">{guide.body}</p>
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}

              <Reveal>
                <aside className="rounded-[28px] border border-slate-800 bg-slate-950 p-6 text-white shadow-xl sm:p-8">
                  <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
                        <BriefcaseBusiness size={20} aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Ready to compare a contract?</p>
                        <h2 className="mt-2 text-xl font-semibold">Use the calculator and status checker in Contractor Tools.</h2>
                      </div>
                    </div>
                    <Link href="/tools" className={buttonClassName({ variant: "accent", className: "shrink-0" })}>
                      Open tools <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  </div>
                </aside>
              </Reveal>

              <Reveal>
                <p className="rounded-2xl border border-slate-200 bg-white p-5 text-xs leading-6 text-slate-500">
                  Educational information only, not tax or legal advice. IR35 status depends on the specific facts of each engagement. For an official view, use HMRC&apos;s{" "}
                  <a className="ir35-focus inline-flex items-center gap-1 rounded font-semibold text-emerald-700 underline" href="https://www.gov.uk/guidance/check-employment-status-for-tax" target="_blank" rel="noopener noreferrer">
                    CEST service <ExternalLink size={12} aria-hidden="true" />
                  </a>{" "}
                  and consider professional advice.
                </p>
              </Reveal>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
