import { supabase } from "@/lib/supabase";

/**
 * Whether the current session is allowed into the signed-in app during
 * private beta. Server-verified via /api/access.
 */
export async function hasBetaAccess(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  try {
    const res = await fetch("/api/access", { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return false;
    const json = (await res.json()) as { allowed?: boolean };
    return json.allowed === true;
  } catch {
    return false;
  }
}
