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

export function latestSubmissionLifecycleEvent<T extends SubmissionLifecycleEvent>(events: T[]): T | undefined {
  return [...events].reverse().find((event) => SUBMISSION_LIFECYCLE_LABELS.includes(event.label as typeof SUBMISSION_LIFECYCLE_LABELS[number]));
}

export function hasActiveSubmission(status: string, events: SubmissionLifecycleEvent[]): boolean {
  return status === "ready" && latestSubmissionLifecycleEvent(events)?.label === "Application submission started";
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
