export const APPLICATION_WORKER_MAX_ATTEMPTS = 5;

export function shouldAutomaticallyRetryWorkerAttention(input: {
  action?: string;
  attempts: number;
}): boolean {
  return (
    input.action === "verification_code" &&
    Number.isFinite(input.attempts) &&
    input.attempts >= 1 &&
    input.attempts < APPLICATION_WORKER_MAX_ATTEMPTS
  );
}

export function applicationWorkerRetryDelayMs(attempts: number): number {
  const safeAttempt = Math.max(1, Math.min(Math.floor(attempts), 4));
  return safeAttempt * 60_000;
}
