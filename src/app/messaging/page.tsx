import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleDashed, Inbox, Link2, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { buttonClassName } from "@/components/ui/button";
import { getIntegrationStatuses } from "@/lib/integration-status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Recruiter Messaging",
  description: "See how IR35Careers links recruiter responses to applications and which email, WhatsApp and SMS capabilities are connected.",
};

export default function MessagingPage() {
  const statuses = getIntegrationStatuses();
  const email = statuses.find((item) => item.id === "inbound_email");
  const messaging = statuses.find((item) => item.id === "messaging");
  const emailReady = email?.state === "connected";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <PublicHeader />
      <main className="ir35-container py-12 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_390px] lg:items-end">
          <div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Recruiter messaging</p><h1 className="mt-3 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">Responses linked to the contract that started them.</h1><p className="mt-5 text-base leading-7 text-slate-600">The inbox, deterministic reply classification and application linking are built. This page reports whether real delivery channels are connected instead of presenting preview messages as received email.</p><div className="mt-7 flex flex-wrap gap-3"><Link href="/inbox" className={buttonClassName({ size: "lg" })}><Inbox size={17} aria-hidden="true" /> Open inbox</Link><Link href="/connections" className={buttonClassName({ variant: "secondary", size: "lg" })}>All connection states</Link></div></div>
          <aside className={`rounded-3xl border p-6 ${emailReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><div className="flex items-start justify-between gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${emailReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{emailReady ? <CheckCircle2 aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${emailReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{emailReady ? "Connected" : "Provider gate"}</span></div><h2 className="mt-5 text-lg font-bold">Recruiter email delivery</h2><p className="mt-2 text-sm leading-6 opacity-80">{email?.scope}</p><p className="mt-4 border-t border-current/10 pt-4 text-xs leading-5 opacity-75">{email?.nextStep}</p></aside>
        </div>

        <section className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            [Mail, "Receive", "A provider-signed inbound event is normalised without trusting message HTML or hidden instructions."],
            [Link2, "Link", "Known aliases and application references attach a recruiter response to the correct role."],
            [Inbox, "Classify", "Interview, rejection, action and update signals are deterministic and remain reviewable."],
            [ShieldCheck, "Forward", "External forwarding is enabled only with consent, verified destinations and a retention policy."],
          ].map(([Icon, title, body]) => { const Item = Icon as typeof Mail; return <article key={String(title)} className="rounded-3xl border border-slate-200 bg-white p-6"><Item size={20} className="text-brand-700" aria-hidden="true" /><h2 className="mt-4 text-lg font-bold">{String(title)}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{String(body)}</p></article>; })}
        </section>

        <section className="mt-10 grid gap-5 lg:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><div className="flex items-start justify-between gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Mail aria-hidden="true" /></span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${emailReady ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{emailReady ? "Connected" : "Not sending"}</span></div><h2 className="mt-5 text-2xl font-bold">Private recruiter email</h2><p className="mt-3 text-sm leading-6 text-slate-600">The product can expose an application-specific alias and linked inbox. Production aliases must use a verified domain, signed webhooks, replay protection and a documented deletion schedule.</p></article>
          <article className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><div className="flex items-start justify-between gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><MessageCircle aria-hidden="true" /></span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">{messaging?.state === "connected" ? "Connected" : "Provider gate"}</span></div><h2 className="mt-5 text-2xl font-bold">WhatsApp and SMS</h2><p className="mt-3 text-sm leading-6 text-slate-600">{messaging?.scope} {messaging?.nextStep}</p></article>
        </section>

        <section className="mt-10 rounded-3xl border border-slate-200 bg-slate-950 p-7 text-white sm:p-9"><p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">Safety boundary</p><h2 className="mt-3 text-2xl font-bold">No message is fabricated, silently forwarded or sent by a preview.</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">When providers are not connected, labelled sample messages demonstrate classification and linking only. IR35Careers does not scrape private inboxes, read unrelated mail or use a recruiter response to change an application without review.</p></section>
      </main>
      <PublicFooter />
    </div>
  );
}
