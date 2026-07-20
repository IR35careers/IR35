import type { Metadata } from "next";
import Link from "next/link";
import { Calculator, ShieldQuestion, TrendingUp, FileCheck2 } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";

export const metadata: Metadata = {
  title: "Free Contractor Tools — IR35 Checker & Take-Home Calculator | IR35Careers",
  description:
    "Free tools for UK contractors: check a contract's IR35 status and estimate your take-home pay inside vs outside IR35 for 2026/27.",
  alternates: { canonical: "https://ir35careers.com/tools" },
};

const LIVE = [
  {
    href: "/tools/take-home",
    icon: Calculator,
    title: "Take-Home Pay Calculator",
    body: "Estimate your annual take-home inside vs outside IR35 for 2026/27, with a full tax breakdown.",
    cta: "Calculate now",
  },
  {
    href: "/tools/ir35-status",
    icon: ShieldQuestion,
    title: "IR35 Status Checker",
    body: "Answer a few questions about your engagement for an indicative inside/outside IR35 view.",
    cta: "Check status",
  },
];

const SOON = [
  { icon: TrendingUp, title: "Day Rate Benchmark", body: "Compare your rate against the market for your skills — coming soon." },
  { icon: FileCheck2, title: "Contract Review Checklist", body: "A pre-signature checklist for your contract — coming soon." },
];

export default function ToolsPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />
      <main className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6">
        <div className="max-w-2xl">
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">IR35Careers</Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Contractor tools</h1>
          <p className="mt-2 text-slate-600">
            Free tools to help UK contractors make sense of IR35 and their day rate. No sign-up
            needed.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {LIVE.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="group rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-green-300 hover:shadow-sm"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-50">
                <t.icon className="text-green-600" size={20} />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">{t.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{t.body}</p>
              <span className="mt-4 inline-block text-sm font-semibold text-green-700 group-hover:underline">
                {t.cta} →
              </span>
            </Link>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {SOON.map((t) => (
            <div key={t.title} className="rounded-2xl border border-slate-200 bg-white p-6 opacity-70">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
                <t.icon className="text-slate-400" size={20} />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-700">{t.title}</h2>
              <p className="mt-1 text-sm text-slate-500">{t.body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
