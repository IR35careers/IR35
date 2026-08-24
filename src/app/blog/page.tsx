import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";

export const metadata: Metadata = { title: "IR35Careers updates", description: "Product updates and practical notes for UK contractors." };

const UPDATES = [
  { date: "19 August 2026", title: "Introducing the truth-first Resume and application workspace", summary: "Role scoring, evidence gaps, side-by-side approval, cover letters, screening answers and dry-run receipts now share one review workflow.", href: "/analyse-job" },
  { date: "19 August 2026", title: "Why IR35 evidence is shown beside every contract", summary: "A listing claim is useful evidence, but it is not a substitute for the client determination or the real working practices.", href: "/resources" },
  { date: "19 August 2026", title: "From saved roles to a contractor pipeline", summary: "The application tracker and linked recruiter inbox reduce manual admin while preserving explicit status changes.", href: "/applications" },
];

export default function BlogPage() {
  return <div className="min-h-screen bg-slate-50"><PublicHeader /><main className="ir35-container py-12 sm:py-16"><div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Product and contractor notes</p><h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">IR35Careers updates</h1><p className="mt-4 text-base leading-7 text-slate-600">What changed, why it matters and how it improves your contract search.</p></div><div className="mt-10 grid gap-5 lg:grid-cols-3">{UPDATES.map((update) => <article key={update.title} className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-card"><p className="flex items-center gap-2 text-xs font-semibold text-slate-500"><CalendarDays size={14} />{update.date}</p><h2 className="mt-4 text-lg font-semibold leading-7 text-slate-950">{update.title}</h2><p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{update.summary}</p><Link href={update.href} className="ir35-focus mt-6 inline-flex min-h-11 items-center gap-2 font-semibold text-brand-700">Read more <ArrowRight size={14} /></Link></article>)}</div></main><PublicFooter /></div>;
}
