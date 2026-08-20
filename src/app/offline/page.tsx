import Link from "next/link";
import { WifiOff } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <PublicHeader />
      <main className="ir35-container flex min-h-[62vh] items-center justify-center py-16">
        <section className="max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-card sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-600"><WifiOff aria-hidden="true" /></span>
          <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-950">You are offline</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">IR35Careers could not reach the latest contract data. Reconnect before relying on job freshness or submitting any account changes.</p>
          <Link href="/jobs" className="ir35-focus mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700">Try contract search again</Link>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
