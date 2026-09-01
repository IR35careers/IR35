import { isApplicationEmailAction } from "@/lib/application-email-action";

export const APPLICATION_WORKER_MAX_ATTEMPTS = 5;

// A callback error is not an employer rejection and must not be presented as
// a terminal worker failure. The approved packet remains recoverable and the
// contractor is given the exact continuation action by storeNeedsUser().
export function applicationWorkerCallbackErrorStatus(): "needs_user" {
  return "needs_user";
}

export function shouldAutomaticallyRetryWorkerAttention(input: {
  action?: string;
  attempts: number;
}): boolean {
  return (
    (isApplicationEmailAction(input.action) ||
      ["browser_continue", "source_access_denied", "runner_timeout"].includes(
        input.action ?? "",
      )) &&
    Number.isFinite(input.attempts) &&
    input.attempts >= 1 &&
    input.attempts < APPLICATION_WORKER_MAX_ATTEMPTS
  );
}

export function applicationWorkerRetryDelayMs(attempts: number): number {
  const safeAttempt = Math.max(1, Math.min(Math.floor(attempts), 4));
  return safeAttempt * 60_000;
}

export function applicationWorkerRetryProgress(action?: string): {
  message: string;
  eventLabel: string;
} {
  if (isApplicationEmailAction(action))
    return {
      message:
        "Waiting for the employer account email. IR35Careers will check again automatically.",
      eventLabel: "Waiting for employer account email",
    };
  if (action === "source_access_denied")
    return {
      message:
        "IR35Careers is retrying the approved application through the employer's available source.",
      eventLabel: "Employer application source queued for retry",
    };
  return {
    message:
      "IR35Careers is retrying the approved employer form automatically. No action is needed while it remains queued.",
    eventLabel: "Employer form queued for automatic retry",
  };
}
