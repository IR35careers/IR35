function text(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 2_000)
    : null;
}

export function submissionReceiptDestination(receipt: unknown): string | null {
  if (!receipt || typeof receipt !== "object") return null;
  return text((receipt as Record<string, unknown>).destination);
}

export function canResumeSavedApplicationStep(
  savedSessionUrl: string,
  approvedJobUrl: string,
): boolean {
  try {
    const saved = new URL(savedSessionUrl);
    const approved = new URL(approvedJobUrl);
    if (saved.protocol !== "https:") return false;
    // A recruiter homepage is not a saved application step. Keep its cookies
    // for sign-in but reopen the specific approved vacancy instead.
    const savedHomepage = saved.pathname === "/" && !saved.search && !saved.hash;
    const approvedHomepage = approved.pathname === "/" && !approved.search && !approved.hash;
    return !savedHomepage || approvedHomepage;
  } catch {
    return false;
  }
}

export function continuationDestinationCandidates(input: {
  savedSessionUrl?: string | null;
  receipt?: unknown;
  approvedJobUrl: string;
}): string[] {
  const candidates = [
    input.savedSessionUrl && canResumeSavedApplicationStep(input.savedSessionUrl, input.approvedJobUrl)
      ? text(input.savedSessionUrl)
      : null,
    submissionReceiptDestination(input.receipt),
    text(input.approvedJobUrl),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}
