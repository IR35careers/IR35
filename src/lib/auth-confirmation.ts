import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePostAuthPath } from "./auth-routing";

export const confirmationEmailSchema = z.email().max(254);
const confirmedEmailSchema = z.object({
  email: confirmationEmailSchema,
  email_confirmed_at: z.iso.datetime({ offset: true }),
});

/** Only a provider-verified email timestamp, never phone/metadata claims. */
export function hasConfirmedApplicationEmail(user: unknown): boolean {
  return confirmedEmailSchema.safeParse(user).success;
}

export const EMAIL_CONFIRMATION_REQUIRED = {
  error: "Confirm your account email before applying. Your saved application has not been submitted.",
  code: "EMAIL_CONFIRMATION_REQUIRED",
  action: "/account?confirmation=1",
} as const;

export type AuthCallbackOutcome = { state: "confirmed"; email: string } | { state: "expired" | "invalid" | "unconfirmed" };
type CallbackAuth = Pick<SupabaseClient["auth"], "initialize" | "getUser">;

export function confirmationFailure(error: unknown): "expired" | "invalid" {
  const result = z.object({ code: z.string().optional(), details: z.object({ code: z.string().optional() }).optional() }).safeParse(error);
  const code = result.success ? result.data.code || result.data.details?.code : "";
  return ["otp_expired", "flow_state_expired", "flow_state_not_found"].includes(code ?? "") ? "expired" : "invalid";
}

export function authCallbackDetails(rawUrl: string): { next: string; failure: "expired" | "invalid" | null } {
  const url = new URL(rawUrl);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const code = url.searchParams.get("error_code") || hash.get("error_code");
  const hasError = ["error", "error_code", "error_description"].some(key => url.searchParams.has(key) || hash.has(key));
  return { next: resolvePostAuthPath(url.searchParams.get("next")), failure: hasError ? confirmationFailure({ code }) : null };
}

export async function completeAuthCallback(auth: CallbackAuth): Promise<AuthCallbackOutcome> {
  try {
    // The SDK caches initializePromise and performs implicit/PKCE handling.
    // Never exchangeCodeForSession again after that one-use exchange.
    const initialized = await auth.initialize();
    if (initialized.error) return { state: confirmationFailure(initialized.error) };
    const { data, error } = await auth.getUser();
    if (error || !data.user) return { state: "invalid" };
    const confirmed = confirmedEmailSchema.safeParse(data.user);
    return confirmed.success ? { state: "confirmed", email: confirmed.data.email } : { state: "unconfirmed" };
  } catch { return { state: "invalid" }; }
}
