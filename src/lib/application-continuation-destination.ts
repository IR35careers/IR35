function text(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 2_000)
    : null;
}

export function submissionReceiptDestination(receipt: unknown): string | null {
  if (!receipt || typeof receipt !== "object") return null;
  return text((receipt as Record<string, unknown>).destination);
}

export function continuationDestinationCandidates(input: {
  savedSessionUrl?: string | null;
  receipt?: unknown;
  approvedJobUrl: string;
}): string[] {
  const candidates = [
    text(input.savedSessionUrl),
    submissionReceiptDestination(input.receipt),
    text(input.approvedJobUrl),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}
