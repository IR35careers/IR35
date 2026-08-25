"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Calculator,
  PoundSterling,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import {
  DEFAULT_UMBRELLA_MARGIN,
  insideIR35TakeHome,
  outsideIR35TakeHome,
  gbp,
  TAX_YEAR,
} from "@/lib/tax";

function ComparisonRow({ label, a, b, sub }: { label: string; a: string; b: string; sub?: boolean }) {
  return (
    <div className={`grid grid-cols-3 items-center gap-2 px-4 py-2.5 ${sub ? "text-sm text-slate-500" : "text-sm"}`}>
      <span className={sub ? "" : "font-medium text-slate-700"}>{label}</span>
      <span className="text-right tabular-nums text-slate-700">{a}</span>
      <span className="text-right tabular-nums text-slate-700">{b}</span>
    </div>
  );
}

function readNumberInput(rawValue: string, multiplier = 1, maximum = Number.POSITIVE_INFINITY): number {
  if (rawValue.trim() === "") return Number.NaN;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.min(maximum, Math.max(0, parsed * multiplier));
}

function inputValue(value: number): number | "" {
  return Number.isFinite(value) ? value : "";
}

export default function TakeHomeCalculator() {
  const [resultPeriod, setResultPeriod] = useState<"annual" | "monthly">("annual");
  const [dayRate, setDayRate] = useState(500);
  const [days, setDays] = useState(220);
  const [expenses, setExpenses] = useState(Number.NaN);
  const [umbrellaMargin, setUmbrellaMargin] = useState(DEFAULT_UMBRELLA_MARGIN);

  const revenue = Number.isFinite(dayRate) && Number.isFinite(days) ? Math.max(0, dayRate * days) : 0;
  const inside = useMemo(() => insideIR35TakeHome(revenue, umbrellaMargin), [revenue, umbrellaMargin]);
  const outside = useMemo(() => outsideIR35TakeHome(revenue, expenses), [revenue, expenses]);
  const expensesExceedRevenue = expenses > revenue;
  const isMonthly = resultPeriod === "monthly";
  const resultDivisor = isMonthly ? 12 : 1;
  const displayMoney = (value: number) => gbp(value / resultDivisor);
  const displayInput = (annualValue: number): number | "" => {
    if (!Number.isFinite(annualValue)) return "";
    return isMonthly ? Number((annualValue / 12).toFixed(2)) : annualValue;
  };
  const inputMultiplier = isMonthly ? 12 : 1;
  const periodLabel = isMonthly ? "Monthly" : "Annual";
  const takeHomeDifference = outside.takeHome - inside.takeHome;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Link href="/tools" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft size={14} /> All tools
        </Link>
        <section className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-slate-950 px-6 py-7 text-white sm:px-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
              <Calculator size={16} aria-hidden="true" /> Contractor calculator
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">IR35 take-home calculator</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              Compare estimated take-home pay inside and outside IR35 for the {TAX_YEAR} tax year in England,
              Wales and Northern Ireland.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 sm:px-8">
            <div>
              <p className="text-sm font-semibold text-slate-900">Show results</p>
              <p className="text-xs text-slate-500">View annual totals or average monthly figures.</p>
            </div>
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1" aria-label="Result period">
            {(["annual", "monthly"] as const).map((period) => (
              <button
                key={period}
                type="button"
                aria-pressed={resultPeriod === period}
                onClick={() => setResultPeriod(period)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                  resultPeriod === period ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                }`}
              >
                {period}
              </button>
            ))}
          </div>
          </div>
        </section>

        {/* Inputs */}
        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5">
            <p className="text-lg font-semibold text-slate-950">Your contract figures</p>
            <p className="mt-1 text-sm text-slate-500">Enter the figures you know. Optional fields can be left blank.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label htmlFor="rate" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span className="grid size-8 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><PoundSterling size={16} aria-hidden="true" /></span>
                Day rate (£)
              </label>
              <input id="rate" type="number" min={0} max={10000} inputMode="decimal" placeholder="500" value={inputValue(dayRate)} onFocus={(event) => event.currentTarget.select()} onChange={(e) => setDayRate(readNumberInput(e.target.value, 1, 10_000))}
                className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold tabular-nums focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20" />
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Suggested day rates">
                {[400, 500, 650, 800].map((rate) => (
                  <button key={rate} type="button" onClick={() => setDayRate(rate)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${dayRate === rate ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}>
                    £{rate}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label htmlFor="days" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span className="grid size-8 place-items-center rounded-lg bg-blue-100 text-blue-700"><CalendarDays size={16} aria-hidden="true" /></span>
                Billable days / {isMonthly ? "month" : "year"}
              </label>
              <input id="days" type="number" min={0} max={isMonthly ? 31 : 366} step={isMonthly ? 0.5 : 1} inputMode="decimal" placeholder={isMonthly ? "20" : "220"} value={displayInput(days)} onFocus={(event) => event.currentTarget.select()} onChange={(e) => setDays(readNumberInput(e.target.value, inputMultiplier, 366))}
                className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold tabular-nums focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20" />
              <p className="mt-3 text-xs leading-5 text-slate-500">Use the number of days you expect to invoice.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label htmlFor="exp" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span className="grid size-8 place-items-center rounded-lg bg-violet-100 text-violet-700"><ReceiptText size={16} aria-hidden="true" /></span>
                {periodLabel} business expenses (£)
              </label>
              <input id="exp" type="number" min={0} inputMode="decimal" placeholder="Optional" value={displayInput(expenses)} onFocus={(event) => event.currentTarget.select()} onChange={(e) => setExpenses(readNumberInput(e.target.value, inputMultiplier))}
                className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold tabular-nums focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20" />
              {expensesExceedRevenue ? <p className="mt-3 text-xs text-amber-700">Expenses are capped at annual revenue in the estimate.</p> : <p className="mt-3 text-xs leading-5 text-slate-500">Used for the outside IR35 estimate.</p>}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label htmlFor="umbrella-margin" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span className="grid size-8 place-items-center rounded-lg bg-amber-100 text-amber-700"><Building2 size={16} aria-hidden="true" /></span>
                {periodLabel} umbrella fee (£)
              </label>
              <input id="umbrella-margin" type="number" min={0} inputMode="decimal" placeholder="Optional" value={displayInput(umbrellaMargin)} onFocus={(event) => event.currentTarget.select()} onChange={(e) => setUmbrellaMargin(readNumberInput(e.target.value, inputMultiplier))}
                className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold tabular-nums focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20" />
              <p className="mt-3 text-xs leading-5 text-slate-500">Used for the inside IR35 umbrella estimate.</p>
            </div>
          </div>
          {isMonthly && (
            <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">
              Monthly inputs are annualised for the tax calculation, then shown as average monthly results.
            </p>
          )}
        </section>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-950 px-5 py-4 text-white shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Estimated {resultPeriod} assignment income</p>
            <p className="mt-1 text-xs text-slate-400">Day rate multiplied by billable days</p>
          </div>
          <span data-testid="assignment-income" className="text-2xl font-bold tabular-nums">{displayMoney(revenue)}</span>
        </div>

        {/* Headline */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border border-rose-200 bg-gradient-to-br from-white to-rose-50 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">Inside IR35</p>
              <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700">Umbrella / PAYE</span>
            </div>
            <p data-testid="inside-take-home" className="mt-3 text-3xl font-bold tabular-nums text-slate-950">{displayMoney(inside.takeHome)}</p>
            <p className="mt-1 text-sm text-slate-500">Estimated {periodLabel.toLowerCase()} take-home</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-rose-100"><div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.min(100, Math.max(0, inside.effectiveRetention * 100))}%` }} /></div>
            <p className="mt-2 text-xs font-medium text-slate-600">{Math.round(inside.effectiveRetention * 100)}% of assignment income retained</p>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Outside IR35</p>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Limited company</span>
            </div>
            <p data-testid="outside-take-home" className="mt-3 text-3xl font-bold tabular-nums text-slate-950">{displayMoney(outside.takeHome)}</p>
            <p className="mt-1 text-sm text-slate-500">Estimated {periodLabel.toLowerCase()} take-home</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Math.max(0, outside.effectiveRetention * 100))}%` }} /></div>
            <p className="mt-2 text-xs font-medium text-slate-600">{Math.round(outside.effectiveRetention * 100)}% of assignment income retained</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><TrendingUp size={19} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-950">Estimated take-home difference</p>
            <p className="text-xs leading-5 text-slate-500">{takeHomeDifference >= 0 ? "Outside IR35 is higher in this estimate." : "Inside IR35 is higher in this estimate."}</p>
          </div>
          <p className="shrink-0 text-lg font-bold tabular-nums text-slate-950">{displayMoney(Math.abs(takeHomeDifference))}</p>
        </div>

        {/* Breakdown */}
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="min-w-[620px]">
          <div className="grid grid-cols-3 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span />
            <span className="text-right">Inside IR35</span>
            <span className="text-right">Outside IR35</span>
          </div>
          <ComparisonRow label={`${periodLabel} gross / revenue`} a={displayMoney(inside.gross)} b={displayMoney(outside.gross)} />
          <ComparisonRow label="Taxable salary" a={displayMoney(inside.taxablePay)} b={displayMoney(outside.taxablePay)} sub />
          <ComparisonRow label="Umbrella fee" a={displayMoney(inside.umbrellaMargin)} b="N/A" sub />
          <ComparisonRow label="Business expenses" a="N/A" b={displayMoney(outside.businessExpenses)} sub />
          <ComparisonRow label="Employer National Insurance" a={displayMoney(inside.employerNationalInsurance)} b={displayMoney(outside.employerNationalInsurance)} sub />
          <ComparisonRow label="Corporation tax" a="N/A" b={displayMoney(outside.corporationTax)} sub />
          <ComparisonRow label="Income tax" a={displayMoney(inside.incomeTax)} b={displayMoney(outside.incomeTax)} sub />
          <ComparisonRow label="National Insurance" a={displayMoney(inside.nationalInsurance)} b={displayMoney(outside.nationalInsurance)} sub />
          <ComparisonRow label="Dividend tax" a="N/A" b={displayMoney(outside.dividendTax)} sub />
          <div className="grid grid-cols-3 items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold">
            <span>Take-home</span>
            <span className="text-right tabular-nums">{displayMoney(inside.takeHome)}</span>
            <span className="text-right tabular-nums">{displayMoney(outside.takeHome)}</span>
          </div>
          </div>
        </div>

        <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
          Estimate only, not tax advice. The outside-IR35 figure assumes a one-director limited
          company using a salary up to £12,570 plus dividends, with all available profit distributed.
          It includes employer National Insurance and does not assume Employment Allowance. VAT,
          pensions and detailed expense planning are excluded. For the inside-IR35 estimate, the
          umbrella fee and employer National Insurance are removed from the assignment income before
          PAYE income tax and employee National Insurance are calculated. Figures use {TAX_YEAR}
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
