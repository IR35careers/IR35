import { describe, expect, it } from "vitest";
import {
  employerNI,
  insideIR35TakeHome,
  outsideIR35TakeHome,
  umbrellaTaxablePay,
} from "@/lib/tax";

describe("contractor take-home calculator", () => {
  it("never creates salary or take-home when there is no revenue", () => {
    expect(outsideIR35TakeHome(0)).toMatchObject({
      gross: 0,
      taxablePay: 0,
      takeHome: 0,
      effectiveRetention: 0,
    });
  });

  it("caps expenses at revenue and never produces negative values", () => {
    const result = outsideIR35TakeHome(5_000, 20_000);
    expect(result.businessExpenses).toBe(5_000);
    expect(result.taxablePay).toBe(0);
    expect(result.takeHome).toBe(0);
  });

  it("deducts umbrella margin and employer NI before PAYE", () => {
    const assignmentIncome = 110_000;
    const margin = 1_200;
    const taxablePay = umbrellaTaxablePay(assignmentIncome, margin);
    const result = insideIR35TakeHome(assignmentIncome, margin);

    expect(result.taxablePay).toBeCloseTo(taxablePay, 2);
    expect(result.taxablePay + result.employerNationalInsurance + result.umbrellaMargin).toBeCloseTo(
      assignmentIncome,
      2,
    );
    expect(result.employerNationalInsurance).toBeCloseTo(employerNI(result.taxablePay), 2);
    expect(result.takeHome).toBeLessThan(result.taxablePay);
  });

  it("includes employer NI in the one-director limited-company estimate", () => {
    const result = outsideIR35TakeHome(60_000);
    expect(result.employerNationalInsurance).toBeGreaterThan(0);
    expect(result.takeHome).toBeLessThan(60_000);
  });

  it("keeps every result finite for invalid and extreme inputs", () => {
    for (const result of [
      insideIR35TakeHome(Number.NaN),
      outsideIR35TakeHome(Number.NaN, Number.POSITIVE_INFINITY),
      insideIR35TakeHome(1_000_000),
      outsideIR35TakeHome(1_000_000),
    ]) {
      expect(Object.values(result).every(Number.isFinite)).toBe(true);
      expect(result.takeHome).toBeGreaterThanOrEqual(0);
    }
  });
});
