import type { Metadata } from "next";
import Link from "next/link";
import { Check, CreditCard, LockKeyhole } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { buttonClassName } from "@/components/ui/button";
import { billingConfig } from "@/lib/billing/stripe";

export const metadata: Metadata = { title: "Public Beta Access", description: "Current public beta access and future plan availability for IR35Careers." };

const CURRENT = ["Browse all indexed UK contracts", "IR35 and source evidence", "Contractor calculators and guides", "Saved roles and searches", "Role-specific CV analysis", "Dry-run application preparation"];
const LOCKED = ["Approved plan benefits will be listed before sale", "Secure checkout remains locked until release approval"];

export default function PricingPage() {
  const billing = billingConfig();
  const proFeatures = billing?.proFeatures ?? LOCKED;
  return <div className="min-h-screen bg-slate-50"><PublicHeader /><main>
    <header className="border-b border-slate-200 bg-white"><div className="ir35-container py-14 text-center sm:py-20"><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Public beta · Clear access, no surprise checkout</p><h1 className="mx-auto mt-3 max-w-3xl text-4xl font-bold tracking-[-0.04em] text-slate-950 sm:text-5xl">{billing ? "Contractor tools with a plan you control." : "Free throughout the current public beta."}</h1><p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-600">Core discovery, IR35 tools and review workflows are available without a card. {billing ? "Pro pricing, renewal terms and cancellation controls are confirmed again in secure hosted checkout." : "Paid pricing will not appear until the beta review, billing, delivery and cancellation paths are complete."}</p></div></header>
    <section className="ir35-container py-12 sm:py-16"><div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
      <article className="rounded-3xl border border-brand-300 bg-white p-7 shadow-card"><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Available now</p><h2 className="mt-3 text-3xl font-bold text-slate-950">Public beta</h2><p className="mt-2 text-4xl font-bold text-slate-950">£0</p><p className="mt-1 text-sm text-slate-500">No payment card required.</p><ul className="mt-6 space-y-3">{CURRENT.map((item)=><li key={item} className="flex gap-2 text-sm text-slate-700"><Check size={17} className="mt-0.5 shrink-0 text-brand-700" />{item}</li>)}</ul><Link href="/account?mode=create&next=%2Fdashboard" prefetch={false} className={buttonClassName({className:"mt-7 w-full"})}>Join the public beta</Link></article>
      <article className={`rounded-3xl border p-7 ${billing ? "border-brand-300 bg-white shadow-card" : "border-slate-200 bg-slate-100"}`}><p className={`text-xs font-bold uppercase tracking-[0.16em] ${billing ? "text-brand-700" : "text-slate-700"}`}>{billing ? "Available to signed-in contractors" : "Coming soon"}</p><h2 className="mt-3 text-3xl font-bold text-slate-950">Contractor Pro</h2><p className={`mt-2 text-2xl font-bold ${billing ? "text-slate-950" : "text-slate-500"}`}>{billing?.proPriceLabel || "Price to be confirmed"}</p><p className="mt-3 text-sm leading-6 text-slate-600">{billing ? "Secure checkout and self-service billing are available from your account." : "Benefits, exact pricing and renewal terms will be published before this plan opens."}</p><ul className="mt-6 space-y-3">{proFeatures.map((item)=><li key={item} className="flex gap-2 text-sm text-slate-600">{billing ? <Check size={17} className="mt-0.5 shrink-0 text-brand-700" /> : <LockKeyhole size={17} className="mt-0.5 shrink-0" />}{item}</li>)}</ul>{billing ? <Link href="/billing" className={buttonClassName({className:"mt-7 w-full"})}><CreditCard size={16} /> Review plan and checkout</Link> : <button disabled className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-200 text-sm font-bold text-slate-500">Coming soon</button>}</article>
    </div><p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-6 text-slate-600">IR35Careers never charges for a prepared or submitted application unless a future plan states the rule clearly and you actively choose it.</p></section>
  </main><PublicFooter /></div>;
}
