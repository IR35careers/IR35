/**
 * GET /api/access — private-beta gate.
 *
 * Returns { allowed: boolean } for the caller's bearer token. During private
 * beta only emails listed in ADMIN_EMAILS may use the signed-in app; everyone
 * else is signed out and pointed at the waitlist.
 *
 * Fails OPEN when ADMIN_EMAILS is unset, so a missing env var can never lock
 * the owner out of their own product.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  // No allowlist configured → beta gate is off.
  if (allowlist.length === 0) return Response.json({ allowed: true, gate: "off" });

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return Response.json({ allowed: false });

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    const email = data?.user?.email?.toLowerCase();
    if (error || !email) return Response.json({ allowed: false });
    return Response.json({ allowed: allowlist.includes(email) });
  } catch {
    return Response.json({ allowed: false });
  }
}
