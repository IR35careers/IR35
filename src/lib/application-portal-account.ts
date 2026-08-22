import { createHmac } from "node:crypto";

/**
 * Produces a stable, high-entropy password per contractor and employer host.
 * It is never persisted and is disclosed only to an authenticated runner or
 * a short-lived browser handoff owned by that contractor.
 */
export function applicationPortalPassword(
  userId: string,
  destination: string,
): string | undefined {
  const secret =
    process.env.APPLICATION_ACCOUNT_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) return undefined;
  const hostname = new URL(destination).hostname.toLowerCase();
  const token = createHmac("sha256", secret)
    .update(`${userId}:${hostname}:portal-v1`)
    .digest("base64url")
    .slice(0, 18);
  return `Ir35!${token}a7`;
}
