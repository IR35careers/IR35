"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, CreditCard, ExternalLink, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { BILLING_POLICY_VERSION } from "@/lib/billing/constants";
import { useWorkspaceState } from "@/lib/workspace/store";

const FREE_FEATURES = ["Contract discovery", "Resume Studio", "Dry-run application receipts", "Application tracker and analytics"];
const PRO_FEATURES = (process.env.NEXT_PUBLIC_PRO_PLAN_FEATURES || "Paid plan benefits are not approved for sale|Checkout remains locked until release approval").split("|").map((value) => value.trim()).filter(Boolean);

async function authenticatedPost(path: string, idempotencyKey?: string, requestBody?: object): Promise<{ url?: string; error?: string }> {
  const { getSupabase } = await import("@/lib/supabase");
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { error: "Your session is no longer available. Sign in again." };
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(requestBody ? { "Content-Type": "application/json" } : {}),
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
    },
    ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
  });
  const responseBody = await response.json().catch(() => ({})) as { url?: string; error?: string };
  return response.ok ? responseBody : { error: responseBody.error || "Billing could not be opened. Please try again." };
}

export function BillingManager() {
  const workspace = useWorkspaceState();
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [managementReady, setManagementReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [message, setMessage] = useState("");
  const [checkoutConsent, setCheckoutConsent] = useState(false);
  const priceLabel = process.env.NEXT_PUBLIC_PRO_PLAN_PRICE_LABEL || "Price not approved";
  const active = workspace.entitlement.billingState === "active" && workspace.entitlement.plan === "pro";
  const sandbox = workspace.entitlement.billingState === "sandbox";
  const needsPaymentReview = workspace.entitlement.billingState === "past_due";

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("checkout") === "success") setMessage("Checkout completed. Your plan is being confirmed and will update shortly.");
    if (query.get("checkout") === "cancelled") setMessage("Checkout was cancelled. No plan change was made.");
    void import("@/lib/supabase").then(async ({ getSupabase }) => {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return null;
      return fetch("/api/integrations/status", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
    })
      .then((response) => response?.ok ? response.json() : null)
      .then((body: { integrations?: Array<{ id: string; checkoutAvailable?: boolean; managementAvailable?: boolean }> } | null) => {
        const billing = body?.integrations?.find((item) => item.id === "billing");
        setCheckoutReady(Boolean(billing?.checkoutAvailable));
        setManagementReady(Boolean(billing?.managementAvailable));
      })
      .catch(() => { setCheckoutReady(false); setManagementReady(false); })
      .finally(() => setChecking(false));
  }, []);

  const openProvider = async (kind: "checkout" | "portal") => {
    setBusy(kind);
    setMessage("");
    const result = await authenticatedPost(
      `/api/billing/${kind}`,
      kind === "checkout" ? crypto.randomUUID() : undefined,
      kind === "checkout" ? { termsAccepted: true, immediateAccessRequested: true, billingPolicyVersion: BILLING_POLICY_VERSION } : undefined,
    );
    if (result.url) window.location.assign(result.url);
    else {
      setMessage(result.error || "Billing could not be opened.");
      setBusy(null);
    }
  };

  return <WorkspacePage accountSection="billing" eyebrow="Plans and billing" title="Choose the plan that fits your search" description="Review your current plan, available features and account options in one place.">
    {message && <p className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-950" role="status">{message}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <article className={`rounded-3xl border p-6 shadow-card ${!active ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wide text-brand-700">Contractor Free</p><p className="mt-3 text-3xl font-bold text-slate-950">£0</p><p className="mt-2 text-sm text-slate-600">No payment card required.</p></div><CreditCard className="text-brand-700" /></div><ul className="mt-6 space-y-3">{FREE_FEATURES.map((feature) => <li key={feature} className="flex items-center gap-2 text-sm text-slate-700"><Check className="text-brand-700" size={16} />{feature}</li>)}</ul><div className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white/70 px-4 text-sm font-bold text-slate-600"><Check size={16} />{active ? "Available if Pro ends" : "Current plan"}</div></article>
      <article className={`rounded-3xl border p-6 shadow-card ${active ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wide text-brand-700">Contractor Pro</p><p className="mt-3 text-3xl font-bold text-slate-950">{checkoutReady ? priceLabel : "Coming soon"}</p><p className="mt-2 text-sm text-slate-600">Pricing and renewal terms are confirmed before payment.</p></div><ShieldCheck className="text-brand-700" /></div><ul className="mt-6 space-y-3">{PRO_FEATURES.map((feature) => <li key={feature} className="flex items-center gap-2 text-sm text-slate-700"><Check className="text-brand-700" size={16} />{feature}</li>)}</ul>{needsPaymentReview && <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">A payment needs attention. Open billing management to review it securely.</p>}{checkoutReady && !active && !sandbox && !needsPaymentReview && <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700"><input type="checkbox" checked={checkoutConsent} onChange={(event) => setCheckoutConsent(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-emerald-700" /><span>I accept the <Link href="/terms" className="font-semibold text-brand-700 underline">Terms</Link> and <Link href="/billing-policy" className="font-semibold text-brand-700 underline">Billing Policy</Link>, and request immediate plan access. I understand the stated cooling-off and possible proportionate-charge terms.</span></label>}{checking ? <div className="mt-6 flex min-h-12 items-center justify-center text-slate-500"><Loader2 className="animate-spin" size={18} /><span className="sr-only">Checking plan availability</span></div> : active || sandbox || needsPaymentReview ? <button type="button" onClick={() => void openProvider("portal")} disabled={!managementReady || busy !== null} className="ir35-focus mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy === "portal" ? <Loader2 className="animate-spin" size={16} /> : <ExternalLink size={16} />} {managementReady ? "Manage billing" : "Billing options unavailable"}</button> : <button type="button" onClick={() => void openProvider("checkout")} disabled={!checkoutReady || !checkoutConsent || busy !== null} className="ir35-focus mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy === "checkout" ? <Loader2 className="animate-spin" size={16} /> : checkoutReady ? <CreditCard size={16} /> : <LockKeyhole size={16} />}{checkoutReady ? "Continue to secure checkout" : "Plans are not available yet"}</button>}</article>
    </div>
  </WorkspacePage>;
}
