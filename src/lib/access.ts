import { supabase } from "@/lib/supabase";

/**
 * Private-beta access state.
 *   allowed  — server confirmed this account may use the app
 *   denied   — server confirmed this account may NOT
 *   unknown  — we couldn't tell (session not hydrated, network blip, config)
 *
 * Callers must only act on an explicit "denied". Treating "unknown" as denied
 * causes sign-in bounce loops right after an OAuth redirect.
 */
export type AccessState = "allowed" | "denied" | "unknown";

export async function checkBetaAccess(): Promise<AccessState> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return "unknown"; // session still hydrating — don't punish

  try {
    const res = await fetch("/api/access", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return "unknown";
    const json = (await res.json()) as { allowed?: boolean | null };
    if (json.allowed === true) return "allowed";
    if (json.allowed === false) return "denied";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Convenience wrapper for flows that just need "should I block this?".
 * Fails OPEN: only an explicit denial blocks.
 */
export async function hasBetaAccess(): Promise<boolean> {
  return (await checkBetaAccess()) !== "denied";
}
