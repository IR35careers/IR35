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
    [
      "verification_code",
      "browser_continue",
      "source_access_denied",
      "runner_timeout",
    ].includes(input.action ?? "") &&
    Number.isFinite(input.attempts) &&
    input.attempts >= 1 &&
    input.attempts < APPLICATION_WORKER_MAX_ATTEMPTS
  );
}

export function applicationWorkerRetryDelayMs(attempts: number): number {
  const safeAttempt = Math.max(1, Math.min(Math.floor(attempts), 4));
  return safeAttempt * 60_000;
}
