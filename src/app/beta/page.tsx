import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FlaskConical, MessageSquareText, RefreshCcw, ShieldCheck } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { buttonClassName } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Public Beta",
  description: "What the IR35Careers public beta includes, what may change and how contractors can share feedback.",
};

const AVAILABLE = [
  "Open signup without a waitlist or invitation code",
  "UK contract discovery with IR35, rate and working-pattern evidence",
  "Role-specific Resume analysis, scoring and missing-keyword identification",
  "Truth-preserving suggested edits with side-by-side approval and version history",
  "Application preparation and tracking with the contractor in control",
];

export default function BetaPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <PublicHeader />
      <main>
        <header className="border-b border-slate-200 bg-white">
          <div className="ir35-container grid gap-8 py-14 sm:py-20 lg:grid-cols-[1fr_0.72fr] lg:items-center">
            <div className="max-w-3xl">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><FlaskConical size={15} /> Open public beta</p>
              <h1 className="mt-4 text-4xl font-bold tracking-[-0.045em] text-slate-950 sm:text-5xl">Useful today. Improving carefully before the official launch.</h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">IR35Careers is open for contractors to use while we validate reliability, refine workflows and act on real feedback. This is not the final commercial release, and there is no announced official-launch date yet.</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/account?mode=create&next=%2Fdashboard" prefetch={false} className={buttonClassName({ size: "lg" })}>Join the public beta <ArrowRight size={16} /></Link>
                <Link href="/contact" className={buttonClassName({ variant: "secondary", size: "lg" })}>Share feedback</Link>
              </div>
            </div>
            <aside className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 sm:p-7">
              <ShieldCheck className="text-emerald-800" size={26} />
              <h2 className="mt-4 text-xl font-bold text-emerald-950">Open access, honest status</h2>
              <p className="mt-2 text-sm leading-6 text-emerald-900">Anyone can create an account. Beta does not mean a private waitlist, and it does not remove our privacy, security or truth-preserving safeguards.</p>
            </aside>
          </div>
        </header>

        <section className="ir35-container grid gap-6 py-12 sm:py-16 lg:grid-cols-[1.05fr_0.95fr]">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Available in beta</p>
            <h2 className="mt-3 text-2xl font-bold text-slate-950">The core contractor workflow is ready to use</h2>
            <ul className="mt-6 space-y-4">
              {AVAILABLE.map((item) => <li key={item} className="flex items-start gap-3 text-sm leading-6 text-slate-700"><CheckCircle2 className="mt-0.5 shrink-0 text-brand-700" size={18} />{item}</li>)}
            </ul>
          </article>

          <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 sm:p-8">
            <RefreshCcw className="text-amber-800" size={24} />
            <h2 className="mt-4 text-2xl font-bold text-amber-950">What beta means</h2>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-amber-950">
              <li>Features, wording and page layouts may change as usability improves.</li>
              <li>Some external email, billing and application providers remain gated until their connection and safety checks pass.</li>
              <li>Occasional defects or interruptions may occur; confirmed issues will be prioritised and recorded.</li>
              <li>No feature will submit an application or approve a Resume change without the contractor&apos;s action.</li>
            </ul>
          </article>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="ir35-container grid gap-6 py-12 sm:py-16 lg:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 p-6"><ShieldCheck className="text-brand-700" /><h2 className="mt-4 font-bold text-slate-950">Verify important information</h2><p className="mt-2 text-sm leading-6 text-slate-600">Check the original advert, rate, IR35 evidence and any Status Determination Statement before acting. Platform guidance is educational, not legal or tax advice.</p></article>
            <article className="rounded-2xl border border-slate-200 p-6"><MessageSquareText className="text-brand-700" /><h2 className="mt-4 font-bold text-slate-950">Report a problem</h2><p className="mt-2 text-sm leading-6 text-slate-600">Use the contact page for broken workflows, inaccurate listings, confusing language or accessibility barriers. Do not include passwords, Resume contents or sensitive personal data.</p></article>
            <article className="rounded-2xl border border-slate-200 p-6"><RefreshCcw className="text-brand-700" /><h2 className="mt-4 font-bold text-slate-950">Follow improvements</h2><p className="mt-2 text-sm leading-6 text-slate-600">Meaningful releases and safety changes are published in the changelog. An official launch will be announced only after the release criteria are satisfied.</p></article>
          </div>
        </section>

        <section className="ir35-container py-12 text-center sm:py-16">
          <h2 className="text-2xl font-bold text-slate-950">Help us make IR35Careers launch-ready</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">Use the beta, tell us where the workflow feels unclear and keep final decisions in your hands.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3"><Link href="/contact" className={buttonClassName()}>Send beta feedback</Link><Link href="/changelog" className={buttonClassName({ variant: "secondary" })}>View changelog</Link></div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
