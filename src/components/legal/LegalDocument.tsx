import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ShieldCheck } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";

export interface LegalSectionLink {
  id: string;
  label: string;
}

export function LegalDocument({
  eyebrow,
  title,
  summary,
  lastUpdated = "20 August 2026",
  sections,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  lastUpdated?: string;
  sections: LegalSectionLink[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f6f8f7] text-slate-950">
      <PublicHeader />
      <main>
        <header className="border-b border-slate-200 bg-white">
          <div className="ir35-container py-12 sm:py-16">
            <Link href="/" className="ir35-focus inline-flex items-center gap-1.5 rounded text-sm font-semibold text-slate-600 hover:text-brand-700">
              <ArrowLeft size={15} aria-hidden="true" /> Back to IR35Careers
            </Link>
            <div className="mt-8 max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">{eyebrow}</p>
              <h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{title}</h1>
              <p className="mt-5 text-base leading-7 text-slate-600 sm:text-lg">{summary}</p>
              <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                <CalendarDays size={14} aria-hidden="true" /> Last updated {lastUpdated}
              </p>
            </div>
          </div>
        </header>

        <div className="ir35-container grid gap-10 py-10 sm:py-14 lg:grid-cols-[250px_minmax(0,760px)] lg:justify-center">
          <aside className="h-max rounded-2xl border border-slate-200 bg-white p-5 lg:sticky lg:top-28">
            <p className="flex items-center gap-2 text-sm font-bold text-slate-950"><ShieldCheck size={16} className="text-brand-700" aria-hidden="true" /> On this page</p>
            <nav className="mt-3" aria-label={`${title} sections`}>
              <ol className="space-y-1">
                {sections.map((section, index) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} className="ir35-focus flex rounded-lg px-2 py-2 text-sm leading-5 text-slate-600 hover:bg-brand-50 hover:text-brand-800">
                      <span className="mr-2 text-xs font-bold tabular-nums text-slate-500">{String(index + 1).padStart(2, "0")}</span>{section.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
          <article className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-card sm:p-9">
            <div className="space-y-10 [&_a]:font-semibold [&_a]:text-brand-700 [&_a]:underline [&_a]:underline-offset-2 [&_h2]:scroll-mt-28 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-[-0.025em] [&_h3]:text-base [&_h3]:font-bold [&_li]:pl-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:text-sm [&_p]:leading-7 [&_p]:text-slate-600 [&_strong]:font-semibold [&_strong]:text-slate-900 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:text-sm [&_ul]:leading-6 [&_ul]:text-slate-600">
              {children}
            </div>
          </article>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

export function LegalCallout({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">{children}</div>;
}
