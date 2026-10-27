import { authCallbackPath, resolvePostAuthPath } from "@/lib/auth-routing";
import { z } from "zod";

const CUSTOMER_ORIGIN = "https://www.ir35careers.com";
const ADMIN_ORIGIN = "https://admin.ir35careers.com";
const STAGING_ORIGIN = "https://staging.ir35careers.com";

function canonicalOrigin(requestOrigin: string): { origin: string; admin: boolean } {
  const parsed = new URL(requestOrigin);
  const staging = z.enum(["true", "false"]).default("false").safeParse(process.env.IR35_STAGING);
  if (!staging.success) throw new Error("Invalid staging OAuth configuration");
  if (staging.data === "true") {
    // Staging must never fall through into a production customer/admin login.
    if (parsed.origin !== STAGING_ORIGIN || parsed.username || parsed.password
      || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("Staging OAuth requires the exact staging origin");
    }
    return { origin: STAGING_ORIGIN, admin: false };
  }
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
  selectAccount = false,
}: {
  requestOrigin: string;
  requestedPath: string | null;
  supabaseUrl: string;
  selectAccount?: boolean;
}): string {
  const target = canonicalOrigin(requestOrigin);
  const path = target.admin ? "/" : resolvePostAuthPath(requestedPath);
  const authorizeUrl = new URL("/auth/v1/authorize", supabaseUrl);
  authorizeUrl.searchParams.set("provider", "google");
  authorizeUrl.searchParams.set("redirect_to", `${target.origin}${target.admin ? path : authCallbackPath(path)}`);
  if (selectAccount) authorizeUrl.searchParams.set("prompt", "select_account");
  return authorizeUrl.toString();
}
