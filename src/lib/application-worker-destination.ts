import { nativeRunnerHostAllowed } from "@/lib/application-runner/ats";

function allowedHttpsDestination(value: unknown): string | undefined {
  const candidate = String(value ?? "").trim();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !nativeRunnerHostAllowed(url.hostname))
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * A discovery board can hand the runner to the employer's final ATS. Once that
 * happens, resume subsequent attempts at the final, validated HTTPS page
 * instead of restarting from the stale discovery link.
 */
export function resolveApplicationTaskDestination(input: {
  taskDestination: unknown;
  receiptDestination?: unknown;
}): string | undefined {
  return (
    allowedHttpsDestination(input.receiptDestination) ??
    allowedHttpsDestination(input.taskDestination)
  );
}
