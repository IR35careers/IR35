import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";

export const metadata: Metadata = { title: "Changelog", description: "A dated record of meaningful IR35Careers product changes." };
const releases = [
  { date: "20 August 2026", title: "Developer connections and referrals", items: ["Protocol-tested read-only MCP server for public contract discovery", "Public provider-connection dashboard with secret-safe state reporting", "Account-owned relationship map and follow-up queue", "Role-linked referral drafts with explicit review and manual sending", "Networking privacy and acceptable-use disclosures"] },
  { date: "20 August 2026", title: "Brand, trust and account-control release", items: ["New original IR35Careers path mark and complete app/social icon set", "Separate sign-in and sign-up actions plus password recovery", "Account-data export and user-confirmed permanent deletion", "Installable mobile web app and offline recovery", "Privacy, cookie, terms, accessibility, AI, security and listing transparency pages", "Faster, source-aware contract filtering and corrected TBC/day-rate handling"] },
  { date: "19 August 2026", title: "Contractor preparation workspace", items: ["Truth-preserving CV analysis with role score and keyword gaps", "Side-by-side suggestion approval, immutable versions and PDF/DOCX export", "Role-grounded cover letter and reviewed screening answers", "Dry-run application receipt, tracker, linked inbox and automation rules"] },
  { date: "19 August 2026", title: "Public contract discovery", items: ["Responsive UK contract search with IR35 evidence, rates and workplace labels", "Original-source handoff, saved roles and alert definitions", "IR35 status checker and take-home calculator"] },
];

export default function ChangelogPage() {
  return <div className="min-h-screen bg-slate-50"><PublicHeader /><main className="ir35-container py-12 sm:py-16"><div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Product history</p><h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] text-slate-950 sm:text-5xl">Changelog</h1><p className="mt-5 text-base leading-7 text-slate-600">A public record of shipped capabilities and the safety boundaries that matter to contractors.</p></div><div className="mt-10 max-w-4xl space-y-6">{releases.map((release)=><article key={release.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"><p className="flex items-center gap-2 text-xs font-bold text-brand-700"><CalendarDays size={14} />{release.date}</p><h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{release.title}</h2><ul className="mt-5 grid gap-3 sm:grid-cols-2">{release.items.map((item)=><li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-600"><CheckCircle2 size={16} className="mt-1 shrink-0 text-brand-700" />{item}</li>)}</ul></article>)}</div><p className="mt-8 text-sm text-slate-600">For implementation detail, safety questions or corrections, <Link href="/contact" className="font-bold text-brand-700 underline">contact IR35Careers</Link>.</p></main><PublicFooter /></div>;
}
