import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Link2, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { buttonClassName } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Recruiter Messaging",
  description: "See how IR35Careers keeps recruiter responses connected to the relevant contract application.",
};

export default function MessagingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <PublicHeader />
      <main className="ir35-container py-12 sm:py-16">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Recruiter messaging</p>
          <h1 className="mt-3 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">Responses linked to the right role.</h1>
          <p className="mt-5 text-base leading-7 text-slate-600">Keep application-related conversations organised without mixing them into your general inbox. You stay in control of every response.</p>
          <div className="mt-7"><Link href="/inbox" className={buttonClassName({ size: "lg" })}><Inbox size={17} aria-hidden="true" /> Open inbox</Link></div>
        </div>

        <section className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            [Mail, "Receive", "Bring application-related replies into a private workspace built around your contract search."],
            [Link2, "Connect", "Keep each recruiter response alongside the role and application it belongs to."],
            [Inbox, "Understand", "Separate interviews, actions, updates and closed applications at a glance."],
            [ShieldCheck, "Decide", "Review the message yourself and stay in control of every next step."],
          ].map(([Icon, title, body]) => { const Item = Icon as typeof Mail; return <article key={String(title)} className="rounded-3xl border border-slate-200 bg-white p-6"><Item size={20} className="text-brand-700" aria-hidden="true" /><h2 className="mt-4 text-lg font-bold">{String(title)}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{String(body)}</p></article>; })}
        </section>

        <section className="mt-10 grid gap-5 lg:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Mail aria-hidden="true" /></span><h2 className="mt-5 text-2xl font-bold">Private application inbox</h2><p className="mt-3 text-sm leading-6 text-slate-600">Review recruiter messages alongside the role and application they relate to, without exposing unrelated personal email.</p></article>
          <article className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><MessageCircle aria-hidden="true" /></span><h2 className="mt-5 text-2xl font-bold">Clear next steps</h2><p className="mt-3 text-sm leading-6 text-slate-600">See whether a message needs your attention, contains an interview update or closes an application, then decide what to do next.</p></article>
        </section>

        <section className="mt-10 rounded-3xl border border-slate-200 bg-slate-950 p-7 text-white sm:p-9"><p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">You stay in control</p><h2 className="mt-3 text-2xl font-bold">Messages never change or submit an application without your review.</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">IR35Careers keeps application conversations separate from unrelated personal email and gives you the final decision on every response.</p></section>
      </main>
      <PublicFooter />
    </div>
  );
}
