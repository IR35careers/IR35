import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Calculator,
  CheckCircle2,
  FileCheck2,
  ShieldQuestion,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { HomeScrollProgress } from "@/components/HomeMotion";
import { Reveal } from "@/components/HomeReveal";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { buttonClassName } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Free Contractor Tools: IR35 Checker and Take-Home Calculator",
  description:
    "Free tools for UK contractors to check an engagement's indicative IR35 status and estimate take-home pay inside and outside IR35.",
  alternates: { canonical: "/tools" },
};

const LIVE_TOOLS = [
  {
    href: "/tools/take-home",
    icon: Calculator,
    eyebrow: "PAY AND TAX",
    title: "Take-Home Pay Calculator",
    body: "Compare estimated annual and monthly take-home for inside and outside IR35 arrangements, with a clear tax breakdown.",
    cta: "Calculate take-home",
    highlights: ["Annual and monthly view", "Inside and outside comparison", "No account needed"],
    accent: "from-emerald-50 via-white to-teal-50",
    iconStyle: "bg-emerald-600 text-white shadow-emerald-200",
  },
  {
    href: "/tools/ir35-status",
    icon: ShieldQuestion,
    eyebrow: "ENGAGEMENT STATUS",
    title: "IR35 Status Checker",
    body: "Work through the key engagement questions and receive an indicative inside or outside IR35 view to support your review.",
    cta: "Check engagement status",
    highlights: ["Working-practice questions", "Clear indicative result", "Private browser session"],
    accent: "from-teal-50 via-white to-cyan-50",
    iconStyle: "bg-teal-700 text-white shadow-teal-200",
  },
] as const;

const UPCOMING = [
  {
    icon: TrendingUp,
    title: "Day Rate Benchmark",
    body: "Compare a proposed rate with similar UK contract opportunities.",
  },
  {
    icon: FileCheck2,
    title: "Contract Review Checklist",
    body: "Organise the questions and documents to review before signing.",
  },
] as const;

export default function ToolsPage() {
  return (
    <div className="min-h-screen bg-[#f7faf8] text-slate-950">
      <HomeScrollProgress />
      <PublicHeader />

      <main>
        <section className="ir35-home-dark relative overflow-hidden border-b border-slate-800 text-white">
          <div aria-hidden="true" className="absolute -right-32 -top-28 h-96 w-96 rounded-full border-[68px] border-emerald-400/10" />
          <div aria-hidden="true" className="absolute bottom-[-9rem] left-[18%] h-72 w-72 rounded-full bg-teal-400/10 blur-3xl" />
          <div className="ir35-container relative grid gap-10 py-14 sm:py-20 lg:grid-cols-[1fr_0.72fr] lg:items-end lg:py-24">
            <Reveal>
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-white/5 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300 backdrop-blur">
                  <Sparkles size={15} aria-hidden="true" />
                  Contractor tools
                </div>
                <h1 className="mt-6 text-4xl font-semibold leading-[1.02] tracking-[-0.055em] sm:text-5xl lg:text-6xl">
                  Make a clearer contract decision.
                </h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                  Free interactive tools for comparing take-home pay and reviewing the likely IR35 position of an engagement. No sign-up required.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.12}>
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
                {[
                  ["2", "Live tools"],
                  ["£0", "Cost"],
                  ["0", "Sign-ups"],
                ].map(([value, label]) => (
                  <div key={label} className="bg-slate-950/70 px-3 py-5 text-center backdrop-blur">
                    <div className="text-2xl font-semibold tracking-tight text-white">{value}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.13em] text-slate-400">{label}</div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        <section className="ir35-home-surface py-12 sm:py-20 lg:py-24">
          <div className="ir35-container">
            <Reveal>
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Available now</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Choose the question you need to answer.</h2>
                <p className="mt-3 text-base leading-7 text-slate-600">Each tool focuses on one decision and explains the result in plain English.</p>
              </div>
            </Reveal>

            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              {LIVE_TOOLS.map((tool, index) => (
                <Reveal key={tool.href} delay={index * 0.08}>
                  <article className={`group relative min-h-full overflow-hidden rounded-[30px] border border-slate-200 bg-gradient-to-br ${tool.accent} p-6 shadow-[0_20px_55px_rgba(15,23,42,0.07)] sm:p-8`}>
                    <div aria-hidden="true" className="absolute -right-16 -top-16 h-52 w-52 rounded-full border-[34px] border-white/65" />
                    <div className="relative">
                      <div className="flex items-start justify-between gap-4">
                        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg ${tool.iconStyle}`}>
                          <tool.icon size={25} aria-hidden="true" />
                        </div>
                        <span className="rounded-full border border-emerald-200 bg-white/85 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800">Available now</span>
                      </div>

                      <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">{tool.eyebrow}</p>
                      <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-3xl">{tool.title}</h3>
                      <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">{tool.body}</p>

                      <ul className="mt-6 grid gap-3 text-sm text-slate-700 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                        {tool.highlights.map((highlight) => (
                          <li key={highlight} className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={16} aria-hidden="true" />
                            {highlight}
                          </li>
                        ))}
                      </ul>

                      <Link href={tool.href} className={buttonClassName({ size: "lg", className: "mt-8 w-full sm:w-auto" })}>
                        {tool.cta} <ArrowRight size={16} aria-hidden="true" />
                      </Link>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white py-12 sm:py-16">
          <div className="ir35-container grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-start">
            <Reveal>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">In development</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">More contractor decisions, made simpler.</h2>
                <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600">These tools are being designed around real contract decisions. They will appear here when they are ready to use.</p>
              </div>
            </Reveal>

            <div className="grid gap-4 sm:grid-cols-2">
              {UPCOMING.map((tool, index) => (
                <Reveal key={tool.title} delay={index * 0.07}>
                  <article className="min-h-full rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200">
                        <tool.icon size={20} aria-hidden="true" />
                      </div>
                      <span className="rounded-full bg-slate-200/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-600">Coming soon</span>
                    </div>
                    <h3 className="mt-5 text-lg font-semibold text-slate-950">{tool.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{tool.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12 sm:py-16">
          <div className="ir35-container">
            <Reveal>
              <div className="flex flex-col gap-6 rounded-[28px] border border-emerald-200 bg-emerald-50/70 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-sm">
                    <BookOpen size={20} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Need the context first?</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight">Read the IR35 guides before using the tools.</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">Understand status, working practices and engagement models in plain English.</p>
                  </div>
                </div>
                <Link href="/resources" className={buttonClassName({ variant: "secondary", className: "shrink-0" })}>
                  Browse guides <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
