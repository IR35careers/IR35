import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, ExternalLink, ShieldQuestion } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";

export const metadata: Metadata = { title: "Contractor research" };

const ARTICLES = [
  {
    title: "What an advertised IR35 label does and does not prove",
    category: "IR35 evidence",
    readTime: "4 min read",
    summary: "An advert is an important signal, but the engagement facts and the client’s status determination still matter. Learn what to request before accepting a contract.",
    href: "https://www.gov.uk/guidance/understanding-off-payroll-working-ir35",
    source: "HMRC guidance",
  },
  {
    title: "Status Determination Statements and contractor disputes",
    category: "Contract decisions",
    readTime: "5 min read",
    summary: "A practical checklist for checking the stated outcome, the reasons supplied and the route available when you disagree with the determination.",
    href: "https://www.gov.uk/government/publications/off-payroll-working-rules-communication-resources/know-the-facts-for-contractors-off-payroll-working-rules-ir35",
    source: "HMRC contractor facts",
  },
  {
    title: "Substitution clauses must match the real working arrangement",
    category: "Working practices",
    readTime: "4 min read",
    summary: "Why contract wording alone is not enough, and why the client’s evidence about personal service and substitution is relevant to a status review.",
    href: "https://www.gov.uk/hmrc-internal-manuals/employment-status-manual/esm8560",
    source: "HMRC Employment Status Manual",
  },
  {
    title: "Using CEST as one part of an engagement review",
    category: "Status tools",
    readTime: "3 min read",
    summary: "What information to gather before using the official tool and why the answers should reflect the individual engagement rather than a generic role.",
    href: "https://www.gov.uk/guidance/check-employment-status-for-tax",
    source: "GOV.UK CEST",
  },
  {
    title: "What a Resume match score can and cannot tell you",
    category: "Applications",
    readTime: "4 min read",
    summary: "A match score highlights evidence and missing terms. It cannot predict an interview, replace recruiter judgement or justify adding experience you do not have.",
    href: "/ai-disclosure",
    source: "IR35Careers methodology",
  },
  {
    title: "Compare rates without confusing an estimate with advice",
    category: "Contract rates",
    readTime: "5 min read",
    summary: "Use consistent assumptions when comparing daily and annual figures, then confirm tax treatment and deductions with the relevant professional or provider.",
    href: "/tools/take-home",
    source: "IR35Careers calculator notes",
  },
] as const;

export default function ResearchPage() {
  return (
    <WorkspacePage
      eyebrow="Research"
      title="Evidence for better contract decisions"
      description="Plain-English reading for UK contractors, with the source shown on every topic. This library is educational and is not legal, tax or employment-status advice."
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Research library</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Start with the evidence, then decide what needs professional advice</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">We separate source-backed IR35 guidance from product methodology, estimates and application preparation. Each card tells you which kind of evidence it uses.</p>
          </div>
          <span className="inline-flex min-h-10 w-max items-center gap-2 rounded-full bg-brand-50 px-4 text-xs font-bold text-brand-800"><BookOpenCheck size={15} /> {ARTICLES.length} reviewed topics</span>
        </div>
      </section>

      <div className="relative mt-6 space-y-4 before:absolute before:bottom-8 before:left-5 before:top-8 before:w-px before:bg-slate-200 sm:before:left-6">
        {ARTICLES.map((article, index) => {
          const external = article.href.startsWith("http");
          const content = (
            <>
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-700">{article.category}</span><span className="text-xs text-slate-500">{article.readTime}</span></div>
              <h2 className="mt-3 text-xl font-semibold leading-7 text-slate-950">{article.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{article.summary}</p>
              <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700">Source: {article.source} {external ? <ExternalLink size={13} /> : <ArrowRight size={13} />}</p>
            </>
          );
          return (
            <article key={article.title} className="relative pl-12 sm:pl-16">
              <span className="absolute left-0 top-6 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-700 sm:h-12 sm:w-12">{index + 1}</span>
              {external ? <a href={article.href} target="_blank" rel="noreferrer" className="ir35-focus block rounded-3xl border border-slate-200 bg-white p-6 shadow-card transition hover:border-brand-300 hover:shadow-lg">{content}</a> : <Link href={article.href} className="ir35-focus block rounded-3xl border border-slate-200 bg-white p-6 shadow-card transition hover:border-brand-300 hover:shadow-lg">{content}</Link>}
            </article>
          );
        })}
      </div>

      <section className="mt-6 flex flex-col gap-5 rounded-3xl bg-slate-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><ShieldQuestion className="mt-1 shrink-0 text-emerald-300" /><div><h2 className="font-semibold">Need an indicative engagement check?</h2><p className="mt-1 text-sm leading-6 text-slate-300">Use the status checker to organise the facts and questions, then obtain professional advice for the real engagement where needed.</p></div></div>
        <Link href="/tools/ir35-status" className="ir35-focus inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-950">Open status checker <ArrowRight size={15} /></Link>
      </section>
    </WorkspacePage>
  );
}
