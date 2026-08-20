import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";

export default function JobDetailLoading() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" aria-busy="true">
      <PublicHeader />
      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-200" aria-hidden="true" />
        <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_520px]">
          <div><div className="h-9 max-w-2xl animate-pulse rounded-lg bg-slate-200" /><div className="mt-3 h-5 w-52 animate-pulse rounded bg-slate-100" /><div className="mt-4 h-7 w-64 animate-pulse rounded-full bg-slate-100" /></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-11 animate-pulse rounded-xl bg-slate-200" />)}</div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]"><div className="space-y-6"><div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white" /><div className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white" /></div><div className="space-y-6"><div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" /><div className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white" /></div></div>
        <p className="sr-only" role="status">Loading contract details</p>
      </main>
      <PublicFooter />
    </div>
  );
}
