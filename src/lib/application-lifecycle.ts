import { z } from "zod";

// Delivery is independent of recruiting stages (interview, offer, rejection).
// These values are stored by Postgres, never inferred from an event's label.
export const applicationDeliveryStatusSchema = z.enum([
  "draft", "needs_profile", "awaiting_approval", "queued", "submitting",
  "submitted", "needs_info", "failed", "external_only", "skipped",
]);
export type ApplicationDeliveryStatus = z.infer<typeof applicationDeliveryStatusSchema>;
export const applicationLifecycleSchema = z.object({
  delivery_status: applicationDeliveryStatusSchema,
  delivery_version: z.coerce.number().int().positive(),
  failure_reason: z.string().nullable(),
  error_detail: z.string().nullable(),
});

const preparation = ["draft", "needs_profile", "awaiting_approval"] as const;
const terminal = ["submitted", "needs_info", "failed", "external_only", "skipped"] as const;
export function isDeliveryInFlight(status?: ApplicationDeliveryStatus): boolean {
  return status === "queued" || status === "submitting";
}
export function canRetryDelivery(status?: ApplicationDeliveryStatus): boolean {
  return status === "needs_info" || status === "failed" || status === "external_only";
}
export function canTransitionDelivery(
  from: ApplicationDeliveryStatus, to: ApplicationDeliveryStatus, explicitRetry = false,
): boolean {
  if (from === to) return true;
  if (explicitRetry) return canRetryDelivery(from) && to === "queued";
  if ((terminal as readonly string[]).includes(from)) return false;
  if ((terminal as readonly string[]).includes(to)) return true;
  const order = [...preparation, "queued", "submitting"] as const;
  return order.indexOf(to as typeof order[number]) > order.indexOf(from as typeof order[number]);
}

export const DELIVERY_LABELS: Record<ApplicationDeliveryStatus, string> = {
  draft: "Draft", needs_profile: "Complete profile", awaiting_approval: "Awaiting approval",
  queued: "Queued", submitting: "Submitting", submitted: "Submitted", needs_info: "Needs you",
  failed: "Not submitted", external_only: "Apply on employer site", skipped: "Skipped",
};

export function isUnresolvedAggregator(destination?: string | null): boolean {
  try {
    const host = new URL(destination ?? "").hostname.toLowerCase().replace(/^www\./, "");
    return host === "adzuna.co.uk" || host.endsWith(".adzuna.co.uk") ||
      host === "reed.co.uk" || host.endsWith(".reed.co.uk");
  } catch { return false; }
}
