import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleDashed, KeyRound, LockKeyhole, PlugZap, ShieldCheck } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { getIntegrationStatuses, type IntegrationState } from "@/lib/integration-status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Integration connections",
  description: "Current IR35Careers data, developer and provider connection states.",
};

const STATE_COPY: Record<IntegrationState, { label: string; style: string }> = {
  available: { label: "Available", style: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  connected: { label: "Connected", style: "border-blue-200 bg-blue-50 text-blue-800" },
  provider_gate: { label: "Provider gate", style: "border-amber-200 bg-amber-50 text-amber-800" },
  not_configured: { label: "Not configured", style: "border-slate-200 bg-slate-100 text-slate-700" },
};

export default function ConnectionsPage() {
  const integrations = getIntegrationStatuses();
  const ready = integrations.filter((item) => item.state === "available" || item.state === "connected").length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <PublicHeader />
      <main className="ir35-container py-12 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:items-end">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Connections</p>
            <h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Every integration, in its real state.</h1>
            <p className="mt-5 text-base leading-7 text-slate-600">Available means usable now. Connected means the production deployment has the required server-side configuration. Provider-gated services stay off until credentials, consent and end-to-end checks are complete.</p>
          </div>
          <aside className="rounded-3xl bg-slate-950 p-6 text-white shadow-card">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">Production readiness</p>
            <p className="mt-3 text-4xl font-bold tabular-nums">{ready} / {integrations.length}</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">Capabilities available or connected. Gated services are deliberately not counted.</p>
          </aside>
        </div>

        <section className="mt-10 grid gap-4 md:grid-cols-2">
          {integrations.map((item) => {
            const state = STATE_COPY[item.state];
            const ReadyIcon = item.state === "available" || item.state === "connected" ? CheckCircle2 : CircleDashed;
            return (
              <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><ReadyIcon size={21} /></span>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${state.style}`}>{state.label}</span>
                </div>
                <h2 className="mt-5 text-lg font-bold">{item.name}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.scope}</p>
                <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Next step</p>
                  <p className="mt-1 text-sm leading-6 text-slate-700">{item.nextStep}</p>
                </div>
              </article>
            );
          })}
        </section>

        <section className="mt-10 grid gap-5 lg:grid-cols-3">
          {[
            [KeyRound, "Secrets stay server-side", "Credentials belong in Vercel environment variables and provider secret stores. Never place them in Git, browser storage or support messages."],
            [ShieldCheck, "Least privilege", "Job sources receive read-only access. Write scopes are added only for an approved, tested workflow."],
            [LockKeyhole, "Human approval", "CV edits, application materials and any future submission remain reviewable and revocable."],
          ].map(([Icon, title, body]) => {
            const Item = Icon as typeof PlugZap;
            return <article key={String(title)} className="rounded-3xl border border-slate-200 bg-white p-6"><Item size={20} className="text-brand-700" /><h2 className="mt-4 font-bold">{String(title)}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{String(body)}</p></article>;
          })}
        </section>

        <p className="mt-8 text-sm text-slate-600">Technical setup details are in the <Link href="/developers" className="font-bold text-brand-700 underline">developer documentation</Link>. If a provider is missing, <Link href="/contact" className="font-bold text-brand-700 underline">contact IR35Careers</Link> with the provider name. Never send a secret.</p>
      </main>
      <PublicFooter />
    </div>
  );
}
