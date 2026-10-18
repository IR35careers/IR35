/**
 * Resolve the page a user should see after authentication.
 *
 * Generic sign-in and sign-up journeys always land on the dashboard. A small
 * set of explicit, private/deep-link intents can be resumed (for example when
 * a user was asked to sign in while saving a particular contract).
 */

const RESUMABLE_DESTINATIONS = [
  "/dashboard",
  "/onboarding",
  "/profile",
  "/saved",
  "/applications",
  "/inbox",
  "/automation",
  "/alerts",
  "/analytics",
  "/network",
  "/research",
  "/billing",
  "/settings",
] as const;

function isResumablePath(pathname: string): boolean {
  if (pathname === "/account/reset") return true;
  if (/^\/jobs\/[^/]+(?:\/resume)?$/.test(pathname)) return true;
  return RESUMABLE_DESTINATIONS.some(
    (destination) => pathname === destination || pathname.startsWith(`${destination}/`)
  );
}

export function authCallbackPath(next?: string | null): string {
  return `/auth/callback?${new URLSearchParams({ next: resolvePostAuthPath(next) })}`;
}

export function canonicalAuthCallbackUrl(next?: string | null): string {
  return `https://www.ir35careers.com${authCallbackPath(next)}`;
}

export function accountSignInPath(next?: string | null): string {
  return `/account?${new URLSearchParams({ next: resolvePostAuthPath(next) })}`;
}

/** Job facts must be loaded by this ID, never copied from untrusted query text. */
export function applicationAuthJobId(next: string): string | null {
  const pathname = new URL(resolvePostAuthPath(next), "https://www.ir35careers.com").pathname;
  const match = /^\/(?:applications\/new|jobs)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/resume)?$/i.exec(pathname);
  return match?.[1] ?? null;
}

export function resolvePostAuthPath(rawDestination: string | null | undefined): string {
  const destination = rawDestination?.trim();
  if (!destination || !destination.startsWith("/") || destination.startsWith("//")) {
    return "/dashboard";
  }

  try {
    const parsed = new URL(destination, "https://www.ir35careers.com");
    if (parsed.origin !== "https://www.ir35careers.com" || !isResumablePath(parsed.pathname)) {
      return "/dashboard";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/dashboard";
  }
}
