import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, BriefcaseBusiness, ClipboardCheck, Cloud, LockKeyhole, ScanSearch } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { PwaInstallPanel } from "@/components/PwaInstallPanel";
import { buttonClassName } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "IR35Careers Mobile App",
  description: "Install the IR35Careers responsive web app on iPhone, iPad, Android or desktop and keep a UK contractor workspace within reach.",
};

const features = [
  [ScanSearch, "Find", "Search live UK contracts by IR35 status, rate, skills, location and working pattern."],
  [BriefcaseBusiness, "Understand", "Open role details with source links, freshness and the evidence behind every IR35 label."],
  [ClipboardCheck, "Prepare", "Score and tailor a CV, review application materials and retain the exact approved packet."],
  [BellRing, "Track", "Return to saved searches, the application pipeline and recruiter-response workspace."],
] as const;

export default function MobilePage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <PublicHeader />
      <main>
        <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_15%_10%,rgba(52,211,153,0.16),transparent_34%),linear-gradient(180deg,#ffffff,#f6f8f7)]">
          <div className="ir35-container grid gap-10 py-14 sm:py-20 lg:grid-cols-[1fr_0.72fr] lg:items-center">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Installable contractor workspace</p>
              <h1 className="mt-3 text-4xl font-bold tracking-[-0.05em] sm:text-5xl lg:text-6xl">Your IR35 contract search, ready on any screen.</h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">Install IR35Careers from a supported browser for a standalone app window. It uses the same account and review-first workflows as the website without pretending to be a native store app.</p>
              <div className="mt-7 flex flex-wrap gap-3"><Link href="/jobs" className={buttonClassName({ size: "lg" })}>Browse contracts</Link><Link href="/dashboard" className={buttonClassName({ variant: "secondary", size: "lg" })}>Open workspace</Link></div>
            </div>
            <aside className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white shadow-2xl shadow-slate-950/15 sm:p-8">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-300 text-slate-950"><Cloud aria-hidden="true" /></span>
              <h2 className="mt-5 text-2xl font-bold">Web-speed, app-like access</h2>
              <ul className="mt-5 space-y-4 text-sm leading-6 text-slate-300"><li>One responsive workspace across phone, tablet and desktop.</li><li>Home-screen icon and standalone window where the browser supports installation.</li><li>Offline recovery screen without caching or misrepresenting stale contract data.</li><li>Account data remains protected by the same authentication and owner-scoped rules.</li></ul>
            </aside>
          </div>
        </section>

        <section className="ir35-container py-12 sm:py-16">
          <PwaInstallPanel />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{features.map(([Icon, title, body]) => <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6"><Icon size={20} className="text-brand-700" aria-hidden="true" /><h2 className="mt-4 text-lg font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{body}</p></article>)}</div>

          <section className="mt-10 grid gap-5 lg:grid-cols-2">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><h2 className="text-2xl font-bold">Install on iPhone or iPad</h2><ol className="mt-5 ml-5 list-decimal space-y-3 text-sm leading-6 text-slate-600"><li>Open <strong>ir35careers.com</strong> in Safari.</li><li>Choose Share, then <strong>Add to Home Screen</strong>.</li><li>Confirm the IR35Careers name and original path mark.</li></ol></article>
            <article className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><h2 className="text-2xl font-bold">Install on Android or desktop</h2><ol className="mt-5 ml-5 list-decimal space-y-3 text-sm leading-6 text-slate-600"><li>Open IR35Careers in Chrome or another supporting browser.</li><li>Use the install button above when shown, or choose <strong>Install app</strong> from the browser menu.</li><li>Launch it from the new IR35Careers app icon.</li></ol></article>
          </section>

          <section className="mt-10 rounded-3xl border border-amber-200 bg-amber-50 p-6 sm:p-8"><div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 shrink-0 text-amber-800" aria-hidden="true" /><div><h2 className="text-lg font-bold text-amber-950">What installation does not change</h2><p className="mt-2 text-sm leading-6 text-amber-900">Installing adds convenient access from your home screen. It does not change your account permissions, application approvals or protected employer steps.</p></div></div></section>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
