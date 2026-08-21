import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, CalendarDays, ShieldQuestion } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";

export const metadata: Metadata = { title: "Contractor research" };

const ARTICLES = [
  { title: "Inside or Outside IR35: what the advertised label does and does not prove", category: "IR35 evidence", summary: "How to separate an advert claim from the client’s status determination and actual working practices.", reviewed: "19 August 2026" },
  { title: "A contractor’s application evidence checklist", category: "Applications", summary: "The facts to confirm before a CV, cover letter or screening answer leaves your workspace.", reviewed: "19 August 2026" },
  { title: "Day rates, umbrella deductions and take-home comparisons", category: "Rates", summary: "A practical way to compare opportunities without treating an estimate as tax advice.", reviewed: "19 August 2026" },
];

export default function ResearchPage() {
  return <WorkspacePage eyebrow="Research" title="Plain-English guidance for UK contractors" description="Reviewed educational material connects product decisions to source evidence. Nothing here is legal, tax or employment-status advice.">
    <div className="grid gap-5 lg:grid-cols-3">{ARTICLES.map((article) => <article key={article.title} className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-card"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><BookOpenCheck size={20} /></span><p className="mt-5 text-xs font-bold uppercase tracking-wide text-brand-700">{article.category}</p><h2 className="mt-2 text-lg font-semibold leading-7 text-slate-950">{article.title}</h2><p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{article.summary}</p><p className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500"><CalendarDays size={14} /> Reviewed {article.reviewed}</p></article>)}</div>
    <section className="mt-6 flex flex-col gap-5 rounded-3xl bg-slate-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><ShieldQuestion className="mt-1 shrink-0 text-emerald-300" /><div><h2 className="font-semibold">Need an indicative check?</h2><p className="mt-1 text-sm text-slate-300">Use the status checker as an educational prompt, then get professional advice for the real engagement.</p></div></div><Link href="/tools/ir35-status" className="ir35-focus inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-950">Open status checker <ArrowRight size={15} /></Link></section>
  </WorkspacePage>;
}
