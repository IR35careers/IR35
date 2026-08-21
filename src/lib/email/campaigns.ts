import type { EmailContent } from "@/lib/email/templates";

const BRAND = {
  navy: "#07111f",
  green: "#087f5b",
  greenLight: "#e9f8f1",
  slate: "#4b5d73",
  border: "#dbe5e1",
  page: "#f3f7f5",
  white: "#ffffff",
  logoSurface: "#effaf5",
};

const DEFAULT_SITE_URL = "https://www.ir35careers.com";
const DEFAULT_LOGO_URL = `${DEFAULT_SITE_URL}/images/generated/brand/ir35careers-mark-256.png`;

export type CampaignAudience = "registered" | "waitlist" | "all" | "custom";

export interface EmailCampaignDraft {
  templateId: string;
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  message: string;
  ctaLabel: string;
  ctaUrl: string;
}

export interface EmailCampaignTemplate extends EmailCampaignDraft {
  name: string;
  description: string;
}

export const emailCampaignTemplates: EmailCampaignTemplate[] = [
  {
    templateId: "feature-update",
    name: "Feature update",
    description: "Introduce a useful product improvement and guide contractors to it.",
    subject: "A new IR35Careers feature is ready",
    preheader: "See what is new in your contractor workspace.",
    eyebrow: "Product update",
    heading: "A better way to prepare for your next contract.",
    message: "We have improved IR35Careers to make your application workflow clearer and faster.\n\nOpen your workspace to explore the update and continue preparing for relevant UK contract opportunities.",
    ctaLabel: "Open my workspace",
    ctaUrl: `${DEFAULT_SITE_URL}/dashboard`,
  },
  {
    templateId: "contractor-guide",
    name: "Contractor guide",
    description: "Share a practical IR35 or contracting resource with your audience.",
    subject: "A practical guide for your next UK contract",
    preheader: "Straightforward guidance from IR35Careers.",
    eyebrow: "Contractor guidance",
    heading: "Make your next contract decision with more clarity.",
    message: "We have published a practical guide to help you understand the details that matter before accepting your next contract.\n\nRead it alongside the role information and seek professional advice when your circumstances require it.",
    ctaLabel: "Read the guide",
    ctaUrl: `${DEFAULT_SITE_URL}/resources`,
  },
  {
    templateId: "service-notice",
    name: "Service notice",
    description: "Communicate planned maintenance or an important account update.",
    subject: "An important IR35Careers service update",
    preheader: "Important information about your IR35Careers workspace.",
    eyebrow: "Service notice",
    heading: "Important information about your workspace.",
    message: "We are making an important service update to keep IR35Careers reliable and secure.\n\nYour account remains protected. If any action is required from you, the instructions will be clearly shown in your workspace.",
    ctaLabel: "View my account",
    ctaUrl: `${DEFAULT_SITE_URL}/dashboard`,
  },
  {
    templateId: "welcome-reminder",
    name: "Welcome reminder",
    description: "Help a new or inactive contractor complete their first steps.",
    subject: "Complete your IR35Careers contractor profile",
    preheader: "Set up your profile and start finding relevant contracts.",
    eyebrow: "Your next step",
    heading: "Your contractor workspace is ready when you are.",
    message: "Complete your profile to make IR35Careers more useful for your contract search. Add your skills, preferences and CV so you can compare your evidence with relevant roles.\n\nYou stay in control of every suggested edit and application step.",
    ctaLabel: "Complete my profile",
    ctaUrl: `${DEFAULT_SITE_URL}/onboarding`,
  },
];

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clean(value: unknown, maximum: number): string {
  return String(value ?? "")
    .replace(/[\u2014\u2192\u00b7]/g, "-")
    .replace(/\r/g, "")
    .trim()
    .slice(0, maximum);
}

function safeSiteUrl(value: unknown): string {
  const candidate = clean(value, 300);
  try {
    const parsed = new URL(candidate, DEFAULT_SITE_URL);
    if (parsed.protocol === "https:" && parsed.hostname === "www.ir35careers.com") return parsed.toString();
  } catch {
    // Use the safe default below.
  }
  return `${DEFAULT_SITE_URL}/dashboard`;
}

export function normaliseCampaignDraft(value: Partial<EmailCampaignDraft>): EmailCampaignDraft {
  return {
    templateId: clean(value.templateId, 60) || "custom",
    subject: clean(value.subject, 120),
    preheader: clean(value.preheader, 180),
    eyebrow: clean(value.eyebrow, 60),
    heading: clean(value.heading, 140),
    message: clean(value.message, 3000),
    ctaLabel: clean(value.ctaLabel, 50),
    ctaUrl: safeSiteUrl(value.ctaUrl),
  };
}

export function validateCampaignDraft(value: Partial<EmailCampaignDraft>): EmailCampaignDraft {
  const draft = normaliseCampaignDraft(value);
  if (draft.subject.length < 5) throw new Error("Add a clear email subject.");
  if (draft.preheader.length < 5) throw new Error("Add useful inbox preview text.");
  if (draft.heading.length < 5) throw new Error("Add a clear email heading.");
  if (draft.message.length < 20) throw new Error("Add a helpful email message.");
  if (draft.ctaLabel.length < 2) throw new Error("Add a button label.");
  return draft;
}

function messageHtml(message: string): string {
  return message
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 16px;color:${BRAND.slate};font-family:Arial,sans-serif;font-size:15px;line-height:25px;">${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

export function renderCampaignEmail(
  input: Partial<EmailCampaignDraft>,
  options: { recipientName?: string | null; audienceReason?: string; logoSource?: string } = {}
): EmailContent {
  const draft = validateCampaignDraft(input);
  const firstName = clean(options.recipientName, 60).split(/\s+/)[0] || "there";
  const reason = clean(options.audienceReason, 240) || "you have an IR35Careers account";
  const logoSource = escapeHtml(options.logoSource || DEFAULT_LOGO_URL);
  const ctaUrl = escapeHtml(draft.ctaUrl);
  const subject = draft.subject;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(subject)}</title>
  <style>
    @media only screen and (max-width:640px) {
      .email-shell { padding:0 !important; }
      .email-card { border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
      .email-pad { padding-left:22px !important; padding-right:22px !important; }
      .email-title { font-size:29px !important; line-height:36px !important; }
      .email-button { display:block !important; text-align:center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};word-spacing:normal;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(draft.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${BRAND.page};">
    <tr><td class="email-shell" align="center" style="padding:32px 12px;">
      <table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:${BRAND.white};border:1px solid ${BRAND.border};border-radius:20px;overflow:hidden;box-shadow:0 14px 40px rgba(7,17,31,.09);">
        <tr><td class="email-pad" bgcolor="${BRAND.navy}" style="background:${BRAND.navy};padding:22px 32px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="vertical-align:middle;width:46px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${BRAND.logoSurface}" style="background:${BRAND.logoSurface};border:1px solid #cfeadd;border-radius:11px;padding:3px;"><img src="${logoSource}" width="36" height="36" alt="IR35Careers" style="display:block;width:36px;height:36px;border:0;border-radius:8px;"></td></tr></table></td>
            <td style="padding-left:11px;vertical-align:middle;color:#ffffff;font-family:Arial,sans-serif;font-size:19px;font-weight:700;letter-spacing:-.3px;">IR35<span style="color:#a9b8c8;font-weight:600;">Careers</span></td>
            <td align="right" style="vertical-align:middle;"><span style="display:inline-block;border:1px solid #3d8f79;border-radius:999px;padding:5px 9px;color:#b9f5df;font-family:Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">For UK contractors</span></td>
          </tr></table>
        </td></tr>
        <tr><td class="email-pad" style="padding:40px 32px 18px;">
          <p style="margin:0 0 13px;color:${BRAND.green};font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(draft.eyebrow || "IR35Careers update")}</p>
          <h1 class="email-title" style="margin:0;max-width:540px;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:34px;font-weight:700;letter-spacing:-1px;line-height:42px;">${escapeHtml(draft.heading)}</h1>
          <p style="margin:20px 0 0;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:15px;font-weight:700;line-height:24px;">Hello ${escapeHtml(firstName)},</p>
        </td></tr>
        <tr><td class="email-pad" style="padding:8px 32px 12px;">${messageHtml(draft.message)}</td></tr>
        <tr><td class="email-pad" style="padding:12px 32px 38px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${BRAND.green}" style="border-radius:10px;"><a class="email-button" href="${ctaUrl}" style="display:inline-block;padding:15px 24px;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">${escapeHtml(draft.ctaLabel)}</a></td></tr></table>
        </td></tr>
        <tr><td class="email-pad" style="border-top:1px solid ${BRAND.border};padding:27px 32px;background:#fbfdfc;">
          <p style="margin:0 0 4px;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:21px;">The IR35Careers Team</p>
          <p style="margin:0;color:${BRAND.slate};font-family:Arial,sans-serif;font-size:12px;line-height:19px;">Helping UK contractors find and prepare for better opportunities.</p>
          <p style="margin:16px 0 0;color:#8995a3;font-family:Arial,sans-serif;font-size:10px;line-height:17px;">You are receiving this service email because ${escapeHtml(reason)}. Read our <a href="${DEFAULT_SITE_URL}/privacy" style="color:#667789;text-decoration:underline;">Privacy Notice</a> and <a href="${DEFAULT_SITE_URL}/terms" style="color:#667789;text-decoration:underline;">Terms of Use</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${draft.eyebrow.toUpperCase()}\n\n${draft.heading}\n\nHello ${firstName},\n\n${draft.message}\n\n${draft.ctaLabel.toUpperCase()}\n${draft.ctaUrl}\n\nThe IR35Careers Team\nHelping UK contractors find and prepare for better opportunities.\n\nYou are receiving this service email because ${reason}.\nPrivacy Notice: ${DEFAULT_SITE_URL}/privacy\nTerms of Use: ${DEFAULT_SITE_URL}/terms`;
  return { subject, html, text };
}
