// The cloud browser runner can spend up to four minutes creating an employer
// account, waiting for ordinary email verification and completing the form.
// Keep a callback safety margin before treating the attempt as abandoned.
export const SUBMISSION_LOCK_MAX_AGE_MS = 330 * 1000;

export const SUBMISSION_LIFECYCLE_LABELS = [
  "Application submission started",
  "Application submitted successfully",
  "Application needs your answer",
  "Application attempt stopped and is ready to retry",
] as const;

type SubmissionLifecycleEvent = { label: string };
type SubmissionAttention = { kind?: string } | null | undefined;

export function isAutomaticWorkerTaskActive(
  status: string | null | undefined,
): boolean {
  return status === "queued" || status === "running";
}

export function latestSubmissionLifecycleEvent<T extends SubmissionLifecycleEvent>(events: T[]): T | undefined {
  return [...events].reverse().find((event) => SUBMISSION_LIFECYCLE_LABELS.includes(event.label as typeof SUBMISSION_LIFECYCLE_LABELS[number]));
}

export function hasActiveSubmission(
  status: string,
  events: SubmissionLifecycleEvent[],
  attention?: SubmissionAttention,
): boolean {
  const latest = latestSubmissionLifecycleEvent(events)?.label;
  if (status === "ready") return latest === "Application submission started";

  // Verification messages can arrive after the employer runner has paused.
  // Keep these applications subscribed to status recovery so an inbound code
  // restarts the saved portal session without another click from the user.
  return (
    status === "needs_review" &&
    attention?.kind === "email_verification" &&
    (latest === "Application needs your answer" ||
      latest === "Application attempt stopped and is ready to retry")
  );
}

export function submissionLockAgeMs(updatedAt: string | null | undefined, nowMs = Date.now()): number {
  const updatedMs = new Date(updatedAt ?? "").getTime();
  if (!Number.isFinite(updatedMs)) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowMs - updatedMs);
}

export function isStaleSubmissionLock(
  updatedAt: string | null | undefined,
  nowMs = Date.now(),
  maxAgeMs = SUBMISSION_LOCK_MAX_AGE_MS,
): boolean {
  return submissionLockAgeMs(updatedAt, nowMs) >= maxAgeMs;
}

export function submissionRetryAfterSeconds(
  updatedAt: string | null | undefined,
  nowMs = Date.now(),
  maxAgeMs = SUBMISSION_LOCK_MAX_AGE_MS,
): number {
  const remainingMs = maxAgeMs - submissionLockAgeMs(updatedAt, nowMs);
  return Math.max(1, Math.ceil(remainingMs / 1000));
}
