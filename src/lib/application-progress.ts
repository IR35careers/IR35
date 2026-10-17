import type { ApplicationDeliveryStatus } from "@/lib/application-lifecycle";

export type ApplicationProgressPhase =
  | "preparing"
  | "queued"
  | "external"
  | "applying"
  | "success"
  | "attention"
  | "error";

export function resolveApplicationProgressPhase({
  submitted,
  busy,
  submissionInProgress,
  hasAttention,
  hasError,
  elapsedSeconds,
  deliveryStatus,
}: {
  submitted: boolean;
  busy: boolean;
  submissionInProgress: boolean;
  hasAttention: boolean;
  hasError: boolean;
  elapsedSeconds: number;
  deliveryStatus?: ApplicationDeliveryStatus;
}): ApplicationProgressPhase {
  if (deliveryStatus) {
    if (deliveryStatus === "submitted") return "success";
    if (deliveryStatus === "queued") return "queued";
    if (deliveryStatus === "submitting") return "applying";
    if (deliveryStatus === "external_only") return "external";
    if (deliveryStatus === "failed") return "error";
    if (busy) return "preparing";
    if (["needs_info", "needs_profile", "awaiting_approval", "skipped"].includes(deliveryStatus)) return "attention";
    return "preparing";
  }
  if (submitted) return "success";
  if (submissionInProgress || (busy && elapsedSeconds >= 3)) return "applying";
  if (busy) return "preparing";
  if (hasAttention) return "attention";
  if (hasError) return "error";
  return "preparing";
}
