import { resolvePostAuthPath } from "@/lib/auth-routing";

const CUSTOMER_ORIGIN = "https://www.ir35careers.com";
const ADMIN_ORIGIN = "https://admin.ir35careers.com";

function canonicalOrigin(requestOrigin: string): { origin: string; admin: boolean } {
  const parsed = new URL(requestOrigin);
  if (parsed.hostname.toLowerCase() === "admin.ir35careers.com") {
    return { origin: ADMIN_ORIGIN, admin: true };
  }
  if (process.env.NODE_ENV !== "production" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
    return { origin: parsed.origin, admin: false };
  }
  return { origin: CUSTOMER_ORIGIN, admin: false };
}

export function buildGoogleOAuthAuthorizeUrl({
  requestOrigin,
  requestedPath,
  supabaseUrl,
}: {
  requestOrigin: string;
  requestedPath: string | null;
  supabaseUrl: string;
}): string {
  const target = canonicalOrigin(requestOrigin);
  const path = target.admin ? "/" : resolvePostAuthPath(requestedPath);
  const authorizeUrl = new URL("/auth/v1/authorize", supabaseUrl);
  authorizeUrl.searchParams.set("provider", "google");
  authorizeUrl.searchParams.set("redirect_to", `${target.origin}${path}`);
  return authorizeUrl.toString();
}
