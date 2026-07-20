/**
 * UK contractor take-home estimation — tax year 2026/27 (England, Wales, NI).
 *
 * Figures verified against the House of Commons Library "Direct taxes: rates
 * and allowances 2026/27" and HMRC-aligned sources (July 2026):
 *   Personal allowance £12,570 (tapered £1 per £2 over £100k, nil at £125,140)
 *   Income tax 20% / 40% / 45%; basic-rate band £37,700; add'l over £125,140
 *   Employee NI 8% (PT £12,570 → UEL £50,270), 2% above
 *   Dividend allowance £500; dividend tax 10.75% / 35.75% / 39.35%
 *   Corporation tax 19% (≤£50k) → 25% (≥£250k) with marginal relief (3/200)
 *
 * These are ESTIMATES for guidance only, not tax advice. The outside-IR35
 * model uses the common low-salary + dividends structure and ignores VAT,
 * pension contributions, and detailed expenses. Scotland sets its own bands
 * and is out of scope here.
 */

export const TAX_YEAR = "2026/27";

const PERSONAL_ALLOWANCE = 12570;
const PA_TAPER_START = 100000;
const BASIC_RATE_BAND = 37700; // taxable income taxed at 20%
const HIGHER_RATE_TOP = 125140; // additional rate starts above this (total income)
const BASIC_LIMIT = 50270; // higher-rate threshold (total income)

const NI_PT = 12570; // primary threshold (annual)
const NI_UEL = 50270; // upper earnings limit (annual)

const DIVIDEND_ALLOWANCE = 500;
const DIV_BASIC = 0.1075;
const DIV_HIGHER = 0.3575;
const DIV_ADDITIONAL = 0.3935;

/** Personal allowance after the £100k taper. */
export function allowanceFor(totalIncome: number): number {
  if (totalIncome <= PA_TAPER_START) return PERSONAL_ALLOWANCE;
  const reduction = Math.floor((totalIncome - PA_TAPER_START) / 2);
  return Math.max(0, PERSONAL_ALLOWANCE - reduction);
}

/** Income tax on non-dividend income (e.g. salary), given an allowance. */
export function incomeTax(income: number, allowance = allowanceFor(income)): number {
  const taxable = Math.max(0, income - allowance);
  let tax = 0;
  const basic = Math.min(taxable, BASIC_RATE_BAND);
  tax += basic * 0.2;
  const higherCeiling = Math.max(0, HIGHER_RATE_TOP - allowance - BASIC_RATE_BAND);
  const higher = Math.min(Math.max(taxable - BASIC_RATE_BAND, 0), higherCeiling);
  tax += higher * 0.4;
  const additional = Math.max(taxable - BASIC_RATE_BAND - higherCeiling, 0);
  tax += additional * 0.45;
  return tax;
}

/** Class 1 employee National Insurance. */
export function employeeNI(gross: number): number {
  let ni = 0;
  if (gross > NI_PT) ni += (Math.min(gross, NI_UEL) - NI_PT) * 0.08;
  if (gross > NI_UEL) ni += (gross - NI_UEL) * 0.02;
  return ni;
}

/** Corporation tax with marginal relief between £50k and £250k. */
export function corporationTax(profit: number): number {
  if (profit <= 0) return 0;
  if (profit <= 50000) return profit * 0.19;
  if (profit >= 250000) return profit * 0.25;
  const main = profit * 0.25;
  const relief = (250000 - profit) * (3 / 200);
  return main - relief;
}

/** Dividend tax, with dividends stacked on top of `otherIncome` (salary). */
export function dividendTax(dividends: number, otherIncome: number): number {
  if (dividends <= 0) return 0;
  const afterAllowance = Math.max(0, dividends - DIVIDEND_ALLOWANCE);
  if (afterAllowance <= 0) return 0;
  // The £500 allowance still consumes band space.
  const basicSpace = Math.max(0, BASIC_LIMIT - Math.max(otherIncome, PERSONAL_ALLOWANCE) - DIVIDEND_ALLOWANCE);
  const higherSpace = Math.max(0, HIGHER_RATE_TOP - BASIC_LIMIT);
  let tax = 0;
  const basic = Math.min(afterAllowance, basicSpace);
  tax += basic * DIV_BASIC;
  const higher = Math.min(Math.max(afterAllowance - basic, 0), higherSpace);
  tax += higher * DIV_HIGHER;
  const additional = Math.max(afterAllowance - basic - higher, 0);
  tax += additional * DIV_ADDITIONAL;
  return tax;
}

export interface TakeHome {
  gross: number;
  incomeTax: number;
  nationalInsurance: number;
  corporationTax: number;
  dividendTax: number;
  takeHome: number;
  effectiveRetention: number; // takeHome / gross
}

/** Inside IR35 / umbrella: taxed as employment income (PAYE). */
export function insideIR35TakeHome(annualGross: number): TakeHome {
  const tax = incomeTax(annualGross);
  const ni = employeeNI(annualGross);
  const takeHome = annualGross - tax - ni;
  return {
    gross: annualGross,
    incomeTax: tax,
    nationalInsurance: ni,
    corporationTax: 0,
    dividendTax: 0,
    takeHome,
    effectiveRetention: annualGross > 0 ? takeHome / annualGross : 0,
  };
}

/**
 * Outside IR35 / limited company: low tax-efficient salary + dividends.
 * `salary` defaults to the personal allowance (a common, tax-efficient choice).
 */
export function outsideIR35TakeHome(
  annualRevenue: number,
  expenses = 0,
  salary = PERSONAL_ALLOWANCE
): TakeHome {
  const profitBeforeTax = Math.max(0, annualRevenue - salary - expenses);
  const corpTax = corporationTax(profitBeforeTax);
  const dividends = Math.max(0, profitBeforeTax - corpTax);
  const salaryTax = incomeTax(salary);
  const salaryNI = employeeNI(salary);
  const divTax = dividendTax(dividends, salary);
  const takeHome = salary - salaryTax - salaryNI + dividends - divTax;
  return {
    gross: annualRevenue,
    incomeTax: salaryTax,
    nationalInsurance: salaryNI,
    corporationTax: corpTax,
    dividendTax: divTax,
    takeHome,
    effectiveRetention: annualRevenue > 0 ? takeHome / annualRevenue : 0,
  };
}

export function gbp(n: number): string {
  return "£" + Math.round(n).toLocaleString("en-GB");
}
