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
  "/admin",
] as const;

function isResumablePath(pathname: string): boolean {
  if (/^\/jobs\/[^/]+(?:\/resume)?$/.test(pathname)) return true;
  return RESUMABLE_DESTINATIONS.some(
    (destination) => pathname === destination || pathname.startsWith(`${destination}/`)
  );
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
