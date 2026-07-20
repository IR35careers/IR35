/**
 * Tax library sanity tests.
 *   npx tsc scripts/test-tax.ts --outDir .test-build --module commonjs \
 *     --target es2020 --esModuleInterop --skipLibCheck --strict
 *   node .test-build/scripts/test-tax.js
 */

import {
  allowanceFor,
  incomeTax,
  employeeNI,
  corporationTax,
  dividendTax,
  insideIR35TakeHome,
  outsideIR35TakeHome,
} from "../src/lib/tax";

let passed = 0;
let failed = 0;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

function check(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`✗ ${name}`);
  }
}

// Allowance taper
check("allowance under £100k is full", allowanceFor(80000) === 12570);
check("allowance at £110k reduced by £5,000", allowanceFor(110000) === 7570);
check("allowance nil at £125,140", allowanceFor(125140) === 0);

// Income tax reference points (standard PA)
check("£12,570 salary → £0 tax", incomeTax(12570) === 0);
// £50,270 income: taxable £37,700 @20% = £7,540
check("£50,270 → £7,540 tax", near(incomeTax(50270), 7540));
// £60,000: £37,700@20% (£7,540) + £9,730@40% (£3,892) = £11,432
check("£60,000 → £11,432 tax", near(incomeTax(60000), 11432));

// Employee NI: £50,270 → (50,270-12,570)*8% = £3,016
check("£50,270 NI → £3,016", near(employeeNI(50270), 3016));
// £60,000 → £3,016 + (60,000-50,270)*2% = £3,016 + £194.60
check("£60,000 NI → £3,210.60", near(employeeNI(60000), 3210.6, 1));

// Corporation tax
check("£40k profit → 19% = £7,600", near(corporationTax(40000), 7600));
check("£300k profit → 25% = £75,000", near(corporationTax(300000), 75000));
check("£100k profit marginal < 25%", corporationTax(100000) < 25000 && corporationTax(100000) > 19000);

// Dividend tax: £30k dividends on £12,570 salary.
// afterAllowance = 29,500; basicSpace = 50,270-12,570-500 = 37,200 → all basic
// 29,500 * 10.75% = £3,171.25
check("£30k dividends basic → £3,171", near(dividendTax(30000, 12570), 3171.25, 1));

// Inside IR35: £500/day × 220 days = £110,000 gross
{
  const r = insideIR35TakeHome(110000);
  check("inside: gross preserved", r.gross === 110000);
  check("inside: take-home < gross", r.takeHome < 110000 && r.takeHome > 60000);
  check("inside: retention 60-75%", r.effectiveRetention > 0.6 && r.effectiveRetention < 0.78);
}

// Outside IR35 retains more at lower incomes (where it's genuinely efficient).
{
  const inside = insideIR35TakeHome(60000);
  const outside = outsideIR35TakeHome(60000);
  check("outside beats inside at £60k", outside.takeHome > inside.takeHome);
  check("outside £60k retention ~78%", outside.effectiveRetention > 0.75 && outside.effectiveRetention < 0.82);
}

// At high fully-extracted income the Ltd advantage largely disappears (25%
// corp tax + 35.75% dividend rate compound) — an accurate 2026/27 result.
{
  const outside = outsideIR35TakeHome(110000);
  check("outside £110k retention ~64%", outside.effectiveRetention > 0.6 && outside.effectiveRetention < 0.68);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
