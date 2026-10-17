import { describe, expect, it } from "vitest";
import {
  clampDailyApplicationLimit,
  FREE_DAILY_APPLICATION_LIMIT,
  hasActivePremiumPlan,
  maximumDailyApplicationLimit,
} from "@/lib/automation/daily-limit";

describe("daily application plan limits", () => {
  it("caps free, preview and inactive accounts at five", () => {
    expect(clampDailyApplicationLimit(25, { plan: "free", billingState: "not_connected" })).toBe(5);
    expect(clampDailyApplicationLimit(10, { plan: "preview", billingState: "sandbox" })).toBe(5);
    expect(clampDailyApplicationLimit(9, { plan: "pro", billingState: "past_due" })).toBe(5);
    expect(maximumDailyApplicationLimit({ plan: "free", billingState: "not_connected" })).toBe(FREE_DAILY_APPLICATION_LIMIT);
  });

  it("allows an active premium account to choose up to twenty-five", () => {
    const entitlement = { plan: "pro" as const, billingState: "active" as const };
    expect(hasActivePremiumPlan(entitlement)).toBe(true);
    expect(clampDailyApplicationLimit(12, entitlement)).toBe(12);
    expect(clampDailyApplicationLimit(99, entitlement)).toBe(25);
  });

  it("normalises invalid values safely", () => {
    expect(clampDailyApplicationLimit(0, null)).toBe(1);
    expect(clampDailyApplicationLimit("not-a-number", null)).toBe(5);
  });
});
