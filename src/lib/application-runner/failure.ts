/** Only failures known to precede the final employer action are replayable. */
export class ApplicationRunnerPreSubmitError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "The hosted browser stopped before submission.", { cause });
    this.name = "ApplicationRunnerPreSubmitError";
  }
}

export function runnerInterruptionAction(finalSubmissionAttempted: boolean): "runner_timeout" | "confirmation_pending" {
  return finalSubmissionAttempted ? "confirmation_pending" : "runner_timeout";
}

export function runnerInterruptionMessage(finalSubmissionAttempted: boolean): string {
  return finalSubmissionAttempted
    ? "The final employer action was attempted, but confirmation was not received. Check the employer page or confirmation email before retrying to avoid a duplicate application."
    : "The hosted browser stopped before the final employer action. Your approved application is saved for an automatic retry.";
}
