import type { Metadata } from "next";
import { Check, CreditCard, LockKeyhole } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";

export const metadata: Metadata = { title: "Plans and billing", robots: { index: false, follow: false } };

const PLANS = [
  { name: "Preview", price: "£0", description: "Try every review workflow locally.", features: ["25 preparation credits", "CV Studio", "Dry-run application receipts", "Local tracker and inbox"], current: true },
  { name: "Contractor Pro", price: "To be confirmed", description: "Production pricing is awaiting approval.", features: ["Cloud application history", "Inbound recruiter mailbox", "Role monitoring", "Provider-backed preparation queue"], current: false },
];

export default function BillingPage() {
  return <WorkspacePage eyebrow="Plans and billing" title="Choose capacity, not hidden automation" description="Billing is not connected yet. Prices and entitlements will only become selectable after product approval, a sandbox checkout and verified webhook handling.">
    <div className="grid gap-5 lg:grid-cols-2">{PLANS.map((plan) => <article key={plan.name} className={`rounded-3xl border p-6 shadow-card ${plan.current ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wide text-brand-700">{plan.name}</p><p className="mt-3 text-3xl font-bold text-slate-950">{plan.price}</p><p className="mt-2 text-sm text-slate-600">{plan.description}</p></div><CreditCard className="text-brand-700" /></div><ul className="mt-6 space-y-3">{plan.features.map((feature) => <li key={feature} className="flex items-center gap-2 text-sm text-slate-700"><Check className="text-brand-700" size={16} />{feature}</li>)}</ul><button type="button" disabled className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-200 px-4 text-sm font-bold text-slate-500">{plan.current ? <Check size={16} /> : <LockKeyhole size={16} />}{plan.current ? "Current preview" : "Checkout not connected"}</button></article>)}</div>
    <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5"><p className="font-semibold text-amber-950">Production gate</p><p className="mt-1 text-sm leading-6 text-amber-900">A payment-provider sandbox, webhook signing secret, idempotent entitlement update and refund/cancellation policy are required before checkout can be enabled.</p></div>
  </WorkspacePage>;
}

