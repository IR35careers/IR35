/**
 * GET /api/access — private-beta gate.
 *
 * Returns { allowed: true | false | null }
 *   true  → on the allowlist (or the gate is off)
 *   false → definitively not on the allowlist
 *   null  → unknown (no/!valid token, or the check couldn't run)
 *
 * Only an explicit `false` should ever sign a user out. Anything else is
 * treated as "unknown" by the client so a transient failure can't lock the
 * owner out of their own product.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  // No allowlist configured → gate is off, everyone in.
  if (allowlist.length === 0) return Response.json({ allowed: true, gate: "off" });

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return Response.json({ allowed: null, reason: "no-token" });

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    const email = data?.user?.email?.toLowerCase();
    if (error || !email) return Response.json({ allowed: null, reason: "unverified" });
    return Response.json({ allowed: allowlist.includes(email) });
  } catch {
    // Misconfiguration (e.g. missing service key) must not lock anyone out.
    return Response.json({ allowed: null, reason: "unavailable" });
  }
}
