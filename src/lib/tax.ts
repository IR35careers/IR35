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
const NI_PT = 12570; // primary threshold (annual)
const NI_UEL = 50270; // upper earnings limit (annual)
const NI_SECONDARY_THRESHOLD = 5000;
const EMPLOYER_NI_RATE = 0.15;

export const DEFAULT_UMBRELLA_MARGIN = 1200;

const DIVIDEND_ALLOWANCE = 500;
const DIV_BASIC = 0.1075;
const DIV_HIGHER = 0.3575;
const DIV_ADDITIONAL = 0.3935;

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

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

/** Class 1 employer National Insurance for a standard category A employee. */
export function employerNI(gross: number): number {
  return Math.max(0, nonNegative(gross) - NI_SECONDARY_THRESHOLD) * EMPLOYER_NI_RATE;
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
export function dividendTax(
  dividends: number,
  otherIncome: number,
  allowance = allowanceFor(Math.max(0, dividends) + Math.max(0, otherIncome)),
): number {
  if (dividends <= 0) return 0;
  const taxableOtherIncome = Math.max(0, otherIncome - allowance);
  const unusedPersonalAllowance = Math.max(0, allowance - otherIncome);
  let remaining = Math.max(0, dividends - unusedPersonalAllowance);
  let dividendAllowanceRemaining = DIVIDEND_ALLOWANCE;
  let bandCursor = taxableOtherIncome;
  let tax = 0;

  const taxBand = (amount: number, rate: number) => {
    const zeroRated = Math.min(amount, dividendAllowanceRemaining);
    dividendAllowanceRemaining -= zeroRated;
    tax += (amount - zeroRated) * rate;
    remaining -= amount;
    bandCursor += amount;
  };

  taxBand(Math.min(remaining, Math.max(0, BASIC_RATE_BAND - bandCursor)), DIV_BASIC);
  taxBand(Math.min(remaining, Math.max(0, HIGHER_RATE_TOP - bandCursor)), DIV_HIGHER);
  taxBand(remaining, DIV_ADDITIONAL);
  return tax;
}

export interface TakeHome {
  gross: number;
  taxablePay: number;
  businessExpenses: number;
  employerNationalInsurance: number;
  umbrellaMargin: number;
  incomeTax: number;
  nationalInsurance: number;
  corporationTax: number;
  dividendTax: number;
  takeHome: number;
  effectiveRetention: number; // takeHome / gross
}

/**
 * Convert an umbrella assignment rate into taxable salary after the umbrella
 * margin and employer NI. Employer NI is a cost of the assignment, not a
 * deduction that should be applied after PAYE has already been calculated.
 */
export function umbrellaTaxablePay(
  annualAssignmentIncome: number,
  annualUmbrellaMargin = DEFAULT_UMBRELLA_MARGIN,
): number {
  const available = Math.max(0, nonNegative(annualAssignmentIncome) - nonNegative(annualUmbrellaMargin));
  if (available <= NI_SECONDARY_THRESHOLD) return available;
  return (available + EMPLOYER_NI_RATE * NI_SECONDARY_THRESHOLD) / (1 + EMPLOYER_NI_RATE);
}

/** Inside IR35 via an umbrella, starting from the advertised assignment rate. */
export function insideIR35TakeHome(
  annualAssignmentIncome: number,
  annualUmbrellaMargin = DEFAULT_UMBRELLA_MARGIN,
): TakeHome {
  const assignmentIncome = nonNegative(annualAssignmentIncome);
  const margin = Math.min(assignmentIncome, nonNegative(annualUmbrellaMargin));
  const taxablePay = umbrellaTaxablePay(assignmentIncome, margin);
  const employerNationalInsurance = employerNI(taxablePay);
  const tax = incomeTax(taxablePay);
  const ni = employeeNI(taxablePay);
  const takeHome = Math.max(0, taxablePay - tax - ni);
  return {
    gross: assignmentIncome,
    taxablePay,
    businessExpenses: 0,
    employerNationalInsurance,
    umbrellaMargin: margin,
    incomeTax: tax,
    nationalInsurance: ni,
    corporationTax: 0,
    dividendTax: 0,
    takeHome,
    effectiveRetention: assignmentIncome > 0 ? takeHome / assignmentIncome : 0,
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
  const revenue = nonNegative(annualRevenue);
  const businessExpenses = Math.min(revenue, nonNegative(expenses));
  const availableBeforePay = Math.max(0, revenue - businessExpenses);
  const affordableSalary = umbrellaTaxablePay(availableBeforePay, 0);
  const actualSalary = Math.min(affordableSalary, nonNegative(salary));
  const employerNationalInsurance = employerNI(actualSalary);
  const profitBeforeTax = Math.max(
    0,
    availableBeforePay - actualSalary - employerNationalInsurance,
  );
  const corpTax = corporationTax(profitBeforeTax);
  const dividends = Math.max(0, profitBeforeTax - corpTax);
  const personalAllowance = allowanceFor(actualSalary + dividends);
  const salaryTax = incomeTax(actualSalary, personalAllowance);
  const salaryNI = employeeNI(actualSalary);
  const divTax = dividendTax(dividends, actualSalary, personalAllowance);
  const takeHome = Math.max(0, actualSalary - salaryTax - salaryNI + dividends - divTax);
  return {
    gross: revenue,
    taxablePay: actualSalary,
    businessExpenses,
    employerNationalInsurance,
    umbrellaMargin: 0,
    incomeTax: salaryTax,
    nationalInsurance: salaryNI,
    corporationTax: corpTax,
    dividendTax: divTax,
    takeHome,
    effectiveRetention: revenue > 0 ? takeHome / revenue : 0,
  };
}

export function gbp(n: number): string {
  const safeValue = Number.isFinite(n) ? n : 0;
  return "£" + Math.round(safeValue).toLocaleString("en-GB");
}
