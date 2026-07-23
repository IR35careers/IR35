"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { insideIR35TakeHome, outsideIR35TakeHome, gbp, TAX_YEAR } from "@/lib/tax";

export default function TakeHomeCalculator() {
  const [dayRate, setDayRate] = useState(500);
  const [days, setDays] = useState(220);
  const [expenses, setExpenses] = useState(0);

  const revenue = Math.max(0, dayRate * days);
  const inside = useMemo(() => insideIR35TakeHome(revenue), [revenue]);
  const outside = useMemo(() => outsideIR35TakeHome(revenue, expenses), [revenue, expenses]);

  const monthly = (n: number) => gbp(n / 12);

  const Row = ({ label, a, b, sub }: { label: string; a: string; b: string; sub?: boolean }) => (
    <div className={`grid grid-cols-3 items-center gap-2 px-4 py-2.5 ${sub ? "text-sm text-slate-500" : "text-sm"}`}>
      <span className={sub ? "" : "font-medium text-slate-700"}>{label}</span>
      <span className="text-right tabular-nums text-slate-700">{a}</span>
      <span className="text-right tabular-nums text-slate-700">{b}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Link href="/tools" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft size={14} /> All tools
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Contractor Take-Home Pay Calculator</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Estimate your annual take-home inside vs outside IR35 for the {TAX_YEAR} tax year (England,
          Wales &amp; Northern Ireland).
        </p>

        {/* Inputs */}
        <div className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-3">
          <div>
            <label htmlFor="rate" className="mb-1.5 block text-sm font-medium text-slate-700">Day rate (£)</label>
            <input id="rate" type="number" min={0} value={dayRate} onChange={(e) => setDayRate(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50" />
          </div>
          <div>
            <label htmlFor="days" className="mb-1.5 block text-sm font-medium text-slate-700">Billable days / year</label>
            <input id="days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50" />
          </div>
          <div>
            <label htmlFor="exp" className="mb-1.5 block text-sm font-medium text-slate-700">Annual expenses (£)</label>
            <input id="exp" type="number" min={0} value={expenses} onChange={(e) => setExpenses(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50" />
          </div>
        </div>

        {/* Headline */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">Inside IR35 (umbrella / PAYE)</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{gbp(inside.takeHome)}</p>
            <p className="text-sm text-slate-500">{monthly(inside.takeHome)}/month · {Math.round(inside.effectiveRetention * 100)}% retained</p>
          </div>
          <div className="rounded-2xl border border-green-200 bg-green-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Outside IR35 (limited company)</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{gbp(outside.takeHome)}</p>
            <p className="text-sm text-slate-500">{monthly(outside.takeHome)}/month · {Math.round(outside.effectiveRetention * 100)}% retained</p>
          </div>
        </div>

        {/* Breakdown */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="grid grid-cols-3 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span />
            <span className="text-right">Inside IR35</span>
            <span className="text-right">Outside IR35</span>
          </div>
          <Row label="Annual gross / revenue" a={gbp(inside.gross)} b={gbp(outside.gross)} />
          <Row label="Corporation tax" a="N/A" b={gbp(outside.corporationTax)} sub />
          <Row label="Income tax" a={gbp(inside.incomeTax)} b={gbp(outside.incomeTax)} sub />
          <Row label="National Insurance" a={gbp(inside.nationalInsurance)} b={gbp(outside.nationalInsurance)} sub />
          <Row label="Dividend tax" a="N/A" b={gbp(outside.dividendTax)} sub />
          <div className="grid grid-cols-3 items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold">
            <span>Take-home</span>
            <span className="text-right tabular-nums">{gbp(inside.takeHome)}</span>
            <span className="text-right tabular-nums">{gbp(outside.takeHome)}</span>
          </div>
        </div>

        <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
          Estimate only, not tax advice. The outside-IR35 figure assumes a common low-salary
          (£12,570) plus dividends structure with all profit distributed, and ignores VAT, pension
          contributions, the £5,000 Employment Allowance and detailed expense planning. Inside-IR35
          is a straight PAYE calculation; via an umbrella, employer NI and the provider margin are
          deducted from the assignment rate first, reducing take-home further. Figures use {TAX_YEAR}
          England/Wales/NI rates. Scotland differs. Always confirm with a qualified accountant.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/tools/ir35-status" className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400">
            Check a contract&apos;s IR35 status →
          </Link>
          <Link href="/jobs" className="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700">
            Browse contracts with rates shown →
          </Link>
        </div>
      </main>
    </div>
  );
}
