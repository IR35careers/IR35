const SITE_ORIGIN = "https://www.ir35careers.com";

export function applicationProfileHref(jobId: string): string {
  const applicationPath = `/applications/new/${encodeURIComponent(jobId)}#needs-attention`;
  return `/profile?returnTo=${encodeURIComponent(applicationPath)}#application-readiness`;
}

export function safeApplicationReturnPath(
  value: string | string[] | undefined,
): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || candidate.length > 500 || candidate.startsWith("//"))
    return undefined;
  try {
    const url = new URL(candidate, SITE_ORIGIN);
    if (
      url.origin !== SITE_ORIGIN ||
      !url.pathname.startsWith("/applications/new/") ||
      url.search ||
      (url.hash && url.hash !== "#needs-attention")
    )
      return undefined;
    return `${url.pathname}${url.hash}`;
  } catch {
    return undefined;
  }
}
