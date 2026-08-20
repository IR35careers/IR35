import { Resend, type EmailReceivedEvent, type GetReceivingEmailResponseSuccess, type WebhookEventPayload } from "resend";

export interface ResendInboundConfig {
  apiKey: string;
  webhookSecret: string;
  domain: string;
}

export interface ResendWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

export interface NormalisedResendEmail {
  providerMessageId: string;
  recipients: string[];
  sender: string;
  subject: string;
  text: string;
  receivedAt: string;
}

function configuredDomain(): string | null {
  const value = (process.env.INBOUND_EMAIL_DOMAIN ?? "").trim().toLowerCase().replace(/^@/, "");
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && value.includes(".") ? value : null;
}

export function resendInboundConfig(): ResendInboundConfig | null {
  const apiKey = (process.env.RESEND_API_KEY || process.env.EMAIL_PROVIDER_API_KEY || "").trim();
  const webhookSecret = (process.env.RESEND_WEBHOOK_SECRET || process.env.INBOUND_MAIL_SIGNING_SECRET || "").trim();
  const domain = configuredDomain();
  if (!apiKey.startsWith("re_") || !webhookSecret.startsWith("whsec_") || !domain) return null;
  return { apiKey, webhookSecret, domain };
}

export function getResend(config: ResendInboundConfig): Resend {
  return new Resend(config.apiKey);
}

export function verifyResendWebhook(
  resend: Resend,
  rawBody: string,
  headers: ResendWebhookHeaders,
  webhookSecret: string
): WebhookEventPayload {
  return resend.webhooks.verify({ payload: rawBody, headers, webhookSecret });
}

export function isReceivedEmailEvent(event: WebhookEventPayload): event is EmailReceivedEvent {
  return event.type === "email.received";
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#")) {
      const hexadecimal = code[1]?.toLowerCase() === "x";
      const point = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

export function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractEmailAddress(value: string): string {
  const bracketed = value.match(/<([^<>]+)>/)?.[1] ?? value;
  const candidate = bracketed.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate.slice(0, 254) : "";
}

function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

export function normaliseResendEmail(
  event: EmailReceivedEvent,
  email: GetReceivingEmailResponseSuccess,
  domain: string
): NormalisedResendEmail {
  const expectedSuffix = `@${domain.toLowerCase()}`;
  const recipients = Array.from(new Set([
    ...event.data.to,
    ...event.data.received_for,
    ...email.to,
    ...email.received_for,
  ].map(extractEmailAddress).filter((address) => address.endsWith(expectedSuffix)))).slice(0, 50);
  const sender = clean(email.from || event.data.from, 254);
  const subject = clean(email.subject || event.data.subject, 500);
  const text = clean(email.text?.trim() || htmlToPlainText(email.html ?? ""), 100_000);
  const dateCandidate = email.created_at || event.data.created_at || event.created_at;
  const receivedAt = Number.isFinite(new Date(dateCandidate).getTime())
    ? new Date(dateCandidate).toISOString()
    : new Date().toISOString();

  return {
    providerMessageId: clean(`resend:${event.data.email_id}`, 300),
    recipients,
    sender,
    subject,
    text,
    receivedAt,
  };
}
