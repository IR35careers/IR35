export type ApplicationProgressPhase =
  | "preparing"
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
}: {
  submitted: boolean;
  busy: boolean;
  submissionInProgress: boolean;
  hasAttention: boolean;
  hasError: boolean;
  elapsedSeconds: number;
}): ApplicationProgressPhase {
  if (submitted) return "success";
  if (submissionInProgress || (busy && elapsedSeconds >= 3)) return "applying";
  if (busy) return "preparing";
  if (hasAttention) return "attention";
  if (hasError) return "error";
  return "preparing";
}
