import type { Metadata } from "next";
import Link from "next/link";
import { Check, LockKeyhole } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { buttonClassName } from "@/components/ui/button";

export const metadata: Metadata = { title: "Pricing", description: "Clear current access and future provider gates for IR35Careers." };

const CURRENT = ["Browse all indexed UK contracts", "IR35 and source evidence", "Contractor calculators and guides", "Saved roles and searches", "Role-specific CV analysis", "Dry-run application preparation"];
const FUTURE = ["Provider-backed email delivery", "Inbound recruiter forwarding", "Live ATS submission adapters", "Payment-provider checkout"];

export default function PricingPage() {
  return <div className="min-h-screen bg-slate-50"><PublicHeader /><main>
    <header className="border-b border-slate-200 bg-white"><div className="ir35-container py-14 text-center sm:py-20"><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Clear access, no surprise checkout</p><h1 className="mx-auto mt-3 max-w-3xl text-4xl font-bold tracking-[-0.04em] text-slate-950 sm:text-5xl">Free while the provider-backed service is being verified.</h1><p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-600">Core discovery, IR35 tools and review workflows are available without a card. Paid pricing will not appear until the billing, delivery and cancellation paths are production-tested.</p></div></header>
    <section className="ir35-container py-12 sm:py-16"><div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
      <article className="rounded-3xl border border-brand-300 bg-white p-7 shadow-card"><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Available now</p><h2 className="mt-3 text-3xl font-bold text-slate-950">Contractor preview</h2><p className="mt-2 text-4xl font-bold text-slate-950">£0</p><p className="mt-1 text-sm text-slate-500">No payment card required.</p><ul className="mt-6 space-y-3">{CURRENT.map((item)=><li key={item} className="flex gap-2 text-sm text-slate-700"><Check size={17} className="mt-0.5 shrink-0 text-brand-700" />{item}</li>)}</ul><Link href="/account?mode=create&next=%2Fdashboard" className={buttonClassName({className:"mt-7 w-full"})}>Create free account</Link></article>
      <article className="rounded-3xl border border-slate-200 bg-slate-100 p-7"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Not sold yet</p><h2 className="mt-3 text-3xl font-bold text-slate-950">Provider-backed plan</h2><p className="mt-2 text-2xl font-bold text-slate-500">Price to be confirmed</p><p className="mt-3 text-sm leading-6 text-slate-600">These capabilities remain visibly locked until a named provider, sandbox, signed webhook, idempotency and user-support process pass their release gates.</p><ul className="mt-6 space-y-3">{FUTURE.map((item)=><li key={item} className="flex gap-2 text-sm text-slate-600"><LockKeyhole size={17} className="mt-0.5 shrink-0" />{item}</li>)}</ul><button disabled className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-200 text-sm font-bold text-slate-500">Checkout not connected</button></article>
    </div><p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-6 text-slate-600">IR35Careers never charges for a prepared or submitted application unless a future plan states the rule clearly and you actively choose it.</p></section>
  </main><PublicFooter /></div>;
}
