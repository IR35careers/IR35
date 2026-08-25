import { nativeRunnerHostAllowed } from "@/lib/application-runner/ats";

function safeHttpsDestination(value: unknown): URL | undefined {
  const candidate = String(value ?? "").trim();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname.toLowerCase() === "localhost"
    )
      return undefined;
    return url;
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
  const task = safeHttpsDestination(input.taskDestination);
  if (!task) return undefined;
  const receipt = safeHttpsDestination(input.receiptDestination);
  if (
    receipt &&
    (nativeRunnerHostAllowed(receipt.hostname) ||
      receipt.hostname.toLowerCase() === task.hostname.toLowerCase())
  )
    return receipt.toString();
  return task.toString();
}
