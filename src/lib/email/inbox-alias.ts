import { createHash } from "node:crypto";
import { resendInboundConfig } from "@/lib/email/resend";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

export interface ConnectedInboxAlias {
  alias: string;
  forwardingEmail: string;
  forwardingEnabled: boolean;
}

function validEmail(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
}

/**
 * Creates an RFC-valid, application-scoped address beneath the contractor's
 * private inbox. The base alias still owns forwarding preferences, while the
 * UUID suffix makes verification and employer replies unambiguous.
 */
export function applicationInboxAlias(
  baseAlias: string,
  applicationId: string,
): string {
  const [local, domain, ...extra] = baseAlias.trim().toLowerCase().split("@");
  const compactId = applicationId.replace(/-/g, "").toLowerCase();
  if (
    !local ||
    !domain ||
    extra.length ||
    !/^[a-z0-9._+-]+$/.test(local) ||
    !/^[a-z0-9.-]+$/.test(domain) ||
    !/^[0-9a-f]{32}$/.test(compactId)
  )
    return baseAlias;
  const candidate = `${local}-a${compactId}@${domain}`;
  return candidate.length <= 254 && candidate.split("@")[0].length <= 64
    ? candidate
    : baseAlias;
}

export function parseApplicationInboxAlias(value: string): {
  baseAlias: string;
  applicationId?: string;
} {
  const address = value.trim().toLowerCase();
  const match = address.match(
    /^([a-z0-9._+-]+)-a([0-9a-f]{32})@([a-z0-9.-]+)$/,
  );
  if (!match)
    return { baseAlias: address };
  const compact = match[2];
  return {
    baseAlias: `${match[1]}@${match[3]}`,
    applicationId: `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`,
  };
}

/**
 * Returns the user's existing private address or creates one when inbound mail
 * is connected. Existing forwarding preferences are never overwritten.
 */
export async function ensureInboxAlias(
  admin: AdminClient,
  userId: string,
  accountEmail: string,
  enableForwarding = true,
): Promise<ConnectedInboxAlias | null> {
  const { data: existing, error: existingError } = await admin
    .from("inbox_aliases")
    .select("alias, forwarding_email, forwarding_enabled, provider_state")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.provider_state === "connected" && validEmail(String(existing.alias ?? ""))) {
    const forwardingEmail = validEmail(String(existing.forwarding_email ?? "")) ? String(existing.forwarding_email) : accountEmail;
    const forwardingEnabled = enableForwarding || Boolean(existing.forwarding_enabled);
    if (forwardingEnabled !== Boolean(existing.forwarding_enabled) || forwardingEmail !== existing.forwarding_email) {
      const { error: updateError } = await admin.from("inbox_aliases").update({
        forwarding_email: forwardingEmail,
        forwarding_enabled: forwardingEnabled,
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId);
      if (updateError) throw new Error(updateError.message);
    }
    return {
      alias: String(existing.alias),
      forwardingEmail,
      forwardingEnabled,
    };
  }

  if (process.env.ENABLE_INBOUND_MAIL?.trim().toLowerCase() !== "true") return null;
  const provider = resendInboundConfig();
  if (!provider || !validEmail(accountEmail)) return null;

  const stableId = createHash("sha256")
    .update(`${userId}:${provider.webhookSecret}`)
    .digest("hex")
    .slice(0, 14);
  const alias = `apply-${stableId}@${provider.domain}`;
  const { error: saveError } = await admin.from("inbox_aliases").upsert({
    user_id: userId,
    alias,
    forwarding_email: accountEmail,
    forwarding_enabled: enableForwarding,
    provider_state: "connected",
    updated_at: new Date().toISOString(),
  });
  if (saveError) throw new Error(saveError.message);
  return { alias, forwardingEmail: accountEmail, forwardingEnabled: enableForwarding };
}
