import { supabase } from "@/lib/supabase";

export type AccessState = "allowed" | "denied" | "unknown";

export interface AccessResult {
  state: AccessState;
  /** The signed-in address, so the UI can name the account that was refused. */
  email?: string;
}

/**
 * Check whether the current session may use the app during private beta.
 * Callers must act only on an explicit "denied"; "unknown" means we could not
 * tell (session still hydrating, network blip, or server misconfiguration).
 */
export async function checkBetaAccess(): Promise<AccessResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { state: "unknown" };

  try {
    const res = await fetch("/api/access", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return { state: "unknown" };
    const json = (await res.json()) as { allowed?: boolean | null; email?: string };
    if (json.allowed === true) return { state: "allowed", email: json.email };
    if (json.allowed === false) return { state: "denied", email: json.email };
    return { state: "unknown", email: json.email };
  } catch {
    return { state: "unknown" };
  }
}

/** Fails OPEN: only an explicit denial blocks. */
export async function hasBetaAccess(): Promise<boolean> {
  return (await checkBetaAccess()).state !== "denied";
}
