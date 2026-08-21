import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTransactionalResend, transactionalEmailConfig } from "@/lib/email/transactional";
import { validRecruitmentEmail } from "@/lib/employer-destinations";
import {
  sourceId,
  validateManagedJobSource,
  type FreeATSType,
} from "@/lib/ats/source-registry";

export const EMPLOYER_VERIFICATION_RUN_TYPE = "employer_destination_verification";
export const EMPLOYER_ONBOARDING_RUN_TYPE = "employer_onboarding_attempt";

export interface EmployerOnboardingInput {
  companyName: string;
  contactName: string;
  recruitmentEmail: string;
  type: FreeATSType;
  slug: string;
  consent: true;
}

type EmployerOnboardingPayload = {
  companyName?: unknown;
  contactName?: unknown;
  recruitmentEmail?: unknown;
  type?: unknown;
  slug?: unknown;
  consent?: unknown;
  website?: unknown;
};

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

export function validateEmployerOnboardingInput(payload: EmployerOnboardingPayload): EmployerOnboardingInput {
  if (cleanText(payload.website, 200)) throw new Error("Unable to accept this request.");
  const source = validateManagedJobSource({
    name: payload.companyName,
    type: payload.type,
    slug: payload.slug,
  });
  const recruitmentEmail = cleanText(payload.recruitmentEmail, 254).toLowerCase();
  const contactName = cleanText(payload.contactName, 100);
  if (contactName.length < 2) throw new Error("Enter your name.");
  if (!validRecruitmentEmail(recruitmentEmail)) throw new Error("Enter a valid employer recruitment email address.");
  if (payload.consent !== true) throw new Error("Confirm that you are authorised to connect this recruitment destination.");
  return {
    companyName: source.name,
    contactName,
    recruitmentEmail,
    type: source.type,
    slug: source.slug,
    consent: true,
  };
}

export function employerOnboardingRateKey(kind: "ip" | "email", value: string): string {
  const salt = process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "ir35careers-onboarding";
  return `${kind}:${createHash("sha256").update(`${salt}:${value.trim().toLowerCase()}`).digest("hex")}`;
}

export async function requestEmployerDestinationVerification(input: {
  source: { name: string; type: FreeATSType; slug: string };
  recruitmentEmail: string;
  requestedBy: string;
  contactName?: string;
  requestKind: "admin" | "employer_self_service";
  client: SupabaseClient;
}): Promise<{ email: string; expiresAt: string; providerId: string }> {
  if (!validRecruitmentEmail(input.recruitmentEmail)) throw new Error("Enter a valid employer recruitment email address.");
  const config = transactionalEmailConfig();
  if (!config) throw new Error("Transactional email delivery is not configured.");
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.ir35careers.com").replace(/\/$/, "");
  const verifyUrl = `${siteUrl}/api/employer-destinations/verify?token=${encodeURIComponent(token)}`;
  const sourceName = escapeHtml(input.source.name);
  const email = input.recruitmentEmail.trim().toLowerCase();
  const requestSummary = {
    action: "requested",
    source_id: sourceId(input.source.type, input.source.slug),
    source_name: input.source.name,
    source_type: input.source.type,
    source_slug: input.source.slug,
    email,
    token_hash: tokenHash,
    expires_at: expiresAt,
    requested_by: input.requestedBy,
    request_kind: input.requestKind,
    contact_name: cleanText(input.contactName, 100) || undefined,
    consent_version: "employer-connection-v1",
    requested_at: new Date().toISOString(),
  };
  const audit = await input.client.from("moderation_logs").insert({
    run_type: EMPLOYER_VERIFICATION_RUN_TYPE,
    summary: requestSummary,
  });
  if (audit.error) throw new Error(`Unable to record employer verification: ${audit.error.message}`);
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><div style="display:none;max-height:0;overflow:hidden">Confirm ${sourceName} recruitment delivery on IR35Careers</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border:1px solid #dbe4ec;border-radius:18px;overflow:hidden"><tr><td style="background:#052e2b;padding:24px 28px;color:#fff"><div style="font-size:18px;font-weight:700">IR35Careers</div><div style="margin-top:6px;color:#a7f3d0;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Employer application connection</div></td></tr><tr><td style="padding:30px 28px"><h1 style="margin:0;font-size:24px;line-height:32px">Confirm your recruitment address</h1><p style="margin:16px 0;color:#475569;font-size:14px;line-height:22px">IR35Careers is connecting <strong>${sourceName}</strong> so candidates can submit applications they have reviewed and approved without leaving IR35Careers.</p><p style="margin:16px 0;color:#475569;font-size:14px;line-height:22px">Confirm only if this address is authorised to receive applications for jobs published on your ${input.source.type} career board. Confirmation places the connection in an IR35Careers authority review and does not enable delivery immediately.</p><a href="${verifyUrl}" style="display:inline-block;margin-top:8px;padding:13px 20px;border-radius:10px;background:#059669;color:#fff;text-decoration:none;font-size:14px;font-weight:700">Confirm recruitment address</a><p style="margin:22px 0 0;color:#64748b;font-size:12px;line-height:19px">This link expires in 24 hours. Nothing is connected unless you confirm. If you did not request this, ignore this email.</p></td></tr><tr><td style="padding:17px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;line-height:18px">IR35Careers · https://www.ir35careers.com/employers · Privacy: https://www.ir35careers.com/privacy</td></tr></table></td></tr></table></body></html>`;
  const delivery = await getTransactionalResend(config).emails.send({
    from: config.from,
    to: [email],
    subject: `Confirm ${input.source.name} application delivery`.slice(0, 150),
    html,
    text: `Confirm your IR35Careers recruitment address for ${input.source.name}: ${verifyUrl}\n\nConfirm only if this address may receive candidate applications for jobs on the connected ${input.source.type} board. Confirmation places the connection in an IR35Careers authority review and does not enable delivery immediately. This link expires in 24 hours.`,
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    tags: [{ name: "email_type", value: "employer_verification" }],
  });
  if (delivery.error || !delivery.data?.id) {
    throw new Error(delivery.error?.message || "The verification email was not accepted for delivery.");
  }
  await input.client.from("moderation_logs").insert({
    run_type: EMPLOYER_VERIFICATION_RUN_TYPE,
    summary: {
      action: "sent",
      source_id: requestSummary.source_id,
      email,
      provider_id: delivery.data.id,
      sent_at: new Date().toISOString(),
    },
  });
  return { email, expiresAt, providerId: delivery.data.id };
}
