import type { Entitlement } from "@/lib/workspace/types";

export const FREE_DAILY_APPLICATION_LIMIT = 5;
export const PREMIUM_DAILY_APPLICATION_LIMIT = 25;

type PlanAccess = Pick<Entitlement, "plan" | "billingState">;

export function hasActivePremiumPlan(entitlement: PlanAccess | null | undefined): boolean {
  return entitlement?.plan === "pro" && entitlement.billingState === "active";
}

export function maximumDailyApplicationLimit(entitlement: PlanAccess | null | undefined): number {
  return hasActivePremiumPlan(entitlement)
    ? PREMIUM_DAILY_APPLICATION_LIMIT
    : FREE_DAILY_APPLICATION_LIMIT;
}

export function clampDailyApplicationLimit(
  value: unknown,
  entitlement: PlanAccess | null | undefined,
): number {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? Math.round(parsed) : FREE_DAILY_APPLICATION_LIMIT;
  return Math.max(1, Math.min(safeValue, maximumDailyApplicationLimit(entitlement)));
}
