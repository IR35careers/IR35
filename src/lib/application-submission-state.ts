export const SUBMISSION_LOCK_MAX_AGE_MS = 6 * 60 * 1000;

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
