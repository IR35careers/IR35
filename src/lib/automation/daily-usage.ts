export const DAILY_LIMIT_COUNTED_SUBMISSION_STATUSES = [
  "queued",
  "processing",
  "succeeded",
] as const;

export function submissionCountsTowardsDailyLimit(status: string): boolean {
  return DAILY_LIMIT_COUNTED_SUBMISSION_STATUSES.includes(
    status as (typeof DAILY_LIMIT_COUNTED_SUBMISSION_STATUSES)[number],
  );
}
