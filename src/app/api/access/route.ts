/**
 * GET /api/access — private-beta gate.
 *
 * Returns { allowed, email, gate } where `allowed` is true | false | null.
 *   true  → this account may use the app (or the gate is off)
 *   false → definitively not on the beta list
 *   null  → unknown (no/invalid token, or the check couldn't run)
 *
 * Only an explicit `false` should sign a user out. `email` is the caller's own
 * address, echoed back so the UI can say WHICH account was refused instead of
 * bouncing silently.
 *
 * Which list is used, in order:
 *   BETA_EMAILS   — who may use the app during private beta
 *   ADMIN_EMAILS  — fallback if BETA_EMAILS isn't set
 * Set BETA_EMAILS to "off" (or "*") to open the app to everyone while keeping
 * ADMIN_EMAILS locked down for the admin panel.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const raw = (process.env.BETA_EMAILS ?? process.env.ADMIN_EMAILS ?? "").trim();
  const gateOff = raw === "" || raw === "*" || raw.toLowerCase() === "off";

  if (gateOff) return Response.json({ allowed: true, gate: "off" });

  const allowlist = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return Response.json({ allowed: null, reason: "no-token" });

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    const email = data?.user?.email?.toLowerCase();
    if (error || !email) return Response.json({ allowed: null, reason: "unverified" });
    return Response.json({ allowed: allowlist.includes(email), email, gate: "on" });
  } catch {
    // Misconfiguration must never lock the owner out of their own product.
    return Response.json({ allowed: null, reason: "unavailable" });
  }
}
