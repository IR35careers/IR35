import { createHash } from "node:crypto";
import { getTransactionalResend, transactionalEmailConfig } from "@/lib/email/transactional";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { InboxClassification } from "@/lib/workspace/types";
import { applicationProfileHref } from "@/lib/application-profile-return";

export type ApplicationNotificationKind =
  | "submitted"
  | "needs_attention"
  | "submission_issue"
  | "interview"
  | "rejection"
  | "update"
  | "message"
  | "reply";

export interface ApplicationNotificationInput {
  kind: ApplicationNotificationKind;
  to: string;
  candidateName?: string;
  jobTitle: string;
  companyName: string;
  jobId?: string;
  applicationId: string;
  originalSubject?: string;
  originalMessage?: string;
  replyTo?: string;
  idempotencyKey: string;
  userId?: string;
  inboxAlias?: string;
  occurredAt?: string;
  action?: string;
}

export interface ApplicationInboxRecord {
  user_id: string;
  application_id: string;
  provider_message_id: string;
  sender: string;
  recipient: string;
  subject: string;
  body_text: string;
  preview: string;
  classification: InboxClassification;
  is_read: boolean;
  received_at: string;
}

const SITE_URL = "https://www.ir35careers.com";
const LOGO_URL = `${SITE_URL}/images/generated/brand/ir35careers-mark-256.png`;
const MOTIVATION = [
  "This result closes one route, not your career. The next relevant opportunity is already worth finding.",
  "A rejection is one employer's decision at one moment. Keep your evidence strong and keep moving.",
  "Your experience has not changed because one application ended. Use what you learned and take the next opportunity.",
  "Progress is built from consistent applications, clear evidence and the courage to continue after a no.",
] as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function validEmail(value: string): boolean {
  const address = value.match(/<([^<>]+)>/)?.[1] ?? value;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address.trim());
}

function providerIdempotencyKey(value: string): string {
  return `ir35-application-${createHash("sha256").update(value).digest("hex")}`;
}

export function applicationNotificationPresentation(input: ApplicationNotificationInput): {
  subject: string;
  eyebrow: string;
  title: string;
  body: string;
  accent: string;
  actionLabel: string;
  actionPath: string;
} {
  const role = `${input.jobTitle} at ${input.companyName}`;
  const applicationPath = `/applications/new/${encodeURIComponent(
    input.jobId || input.applicationId,
  )}?applicationId=${encodeURIComponent(input.applicationId)}`;
  switch (input.kind) {
    case "submitted":
      return {
        subject: `Application submitted: ${role}`,
        eyebrow: "Application confirmed",
        title: "Your application was submitted successfully",
        body: `IR35Careers received confirmation that your application for ${role} reached the application system. You can follow every update from your application tracker.`,
        accent: "#087f5b",
        actionLabel: "View application",
        actionPath: applicationPath,
      };
    case "needs_attention":
      if (input.action === "/profile")
        return {
          subject: `Complete your profile: ${role}`,
          eyebrow: "Profile information needed",
          title: "Complete the highlighted profile details",
          body: `Your approved application for ${role} is saved. Complete the highlighted reusable profile details, then return to the same application and continue.`,
          accent: "#b45309",
          actionLabel: "Complete profile",
          actionPath: applicationProfileHref(
            input.jobId || input.applicationId,
          ),
        };
      return {
        subject: `Your answer is needed: ${role}`,
        eyebrow: "Needs your attention",
        title: "The application needs information from you",
        body: `The application for ${role} is paused because an employer question could not be answered safely from your saved profile. Review the highlighted question and the application will continue after you confirm it.`,
        accent: "#b45309",
        actionLabel: "Answer the question",
        actionPath: `${applicationPath}#needs-attention`,
      };
    case "submission_issue":
      return {
        subject: `Application ready to retry: ${role}`,
        eyebrow: "Application update",
        title: "Your application needs another attempt",
        body: `IR35Careers stopped before the employer confirmed your application for ${role}. It has not been marked as submitted. Your approved Resume and answers are saved. Open the application and select Apply again.`,
        accent: "#b45309",
        actionLabel: "Open and retry",
        actionPath: `${applicationPath}#needs-attention`,
      };
    case "interview":
      return {
        subject: `Interview update: ${role}`,
        eyebrow: "Congratulations",
        title: "You have an interview update",
        body: `A recruiter message about an interview for ${role} arrived in your IR35Careers inbox. Review the original message and respond promptly.`,
        accent: "#087f5b",
        actionLabel: "Read interview message",
        actionPath: "/inbox",
      };
    case "rejection": {
      const quote = MOTIVATION[Math.abs(input.idempotencyKey.split("").reduce((sum, value) => sum + value.charCodeAt(0), 0)) % MOTIVATION.length];
      return {
        subject: `Application update: ${role}`,
        eyebrow: "Application update",
        title: "This application has closed",
        body: `The employer has indicated that your application for ${role} will not progress. ${quote}`,
        accent: "#be123c",
        actionLabel: "Find more opportunities",
        actionPath: "/jobs",
      };
    }
    case "update":
      return {
        subject: `Application update: ${role}`,
        eyebrow: "Application update",
        title: "There is an update on your application",
        body: `A new status message for ${role} arrived in your IR35Careers inbox and has been linked to the correct application.`,
        accent: "#1d4ed8",
        actionLabel: "Read the update",
        actionPath: "/inbox",
      };
    case "message":
      return {
        subject: `Application message: ${role}`,
        eyebrow: "Application inbox",
        title: "A new application message has arrived",
        body: `A message associated with ${role} arrived at your private IR35Careers application address. Review the original sender and message before taking action.`,
        accent: "#1d4ed8",
        actionLabel: "Read the message",
        actionPath: "/inbox",
      };
    default:
      return {
        subject: `Recruiter message: ${role}`,
        eyebrow: "Recruiter response",
        title: "A recruiter has replied",
        body: `A recruiter message for ${role} arrived in your IR35Careers inbox and has been linked to the application.`,
        accent: "#1d4ed8",
        actionLabel: "Read the message",
        actionPath: "/inbox",
      };
  }
}

function inboxClassification(kind: ApplicationNotificationKind): InboxClassification {
  if (kind === "needs_attention") return "action_required";
  if (kind === "interview") return "interview";
  if (kind === "rejection") return "rejection";
  if (kind === "submitted" || kind === "submission_issue" || kind === "update") return "application_update";
  return "other";
}

export function buildApplicationInboxRecord(input: ApplicationNotificationInput): ApplicationInboxRecord | null {
  if (!input.userId || !/^[0-9a-f-]{36}$/i.test(input.userId) || !/^[0-9a-f-]{36}$/i.test(input.applicationId)) return null;
  const view = applicationNotificationPresentation(input);
  const original = input.originalMessage?.trim();
  const body = [view.body, original ? `Original message${input.originalSubject ? `: ${input.originalSubject}` : ""}\n\n${original}` : ""]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 40_000);
  return {
    user_id: input.userId,
    application_id: input.applicationId,
    provider_message_id: `ir35-system-${createHash("sha256").update(input.idempotencyKey).digest("hex")}`,
    sender: "IR35Careers",
    recipient: input.inboxAlias?.trim() || input.to,
    subject: view.subject.slice(0, 300),
    body_text: body,
    preview: body.replace(/\s+/g, " ").slice(0, 220),
    classification: inboxClassification(input.kind),
    is_read: false,
    received_at: input.occurredAt || new Date().toISOString(),
  };
}

export async function recordApplicationNotification(
  input: ApplicationNotificationInput,
  admin = getSupabaseAdmin(),
): Promise<boolean> {
  const record = buildApplicationInboxRecord(input);
  if (!record) return false;
  const { error } = await admin.from("inbox_messages").upsert(record, {
    onConflict: "user_id,provider_message_id",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(error.message);
  return true;
}

export async function sendApplicationNotification(input: ApplicationNotificationInput): Promise<string | null> {
  if (input.userId) {
    await recordApplicationNotification(input).catch((error: unknown) => {
      console.error("application_notification_inbox_failed", {
        kind: input.kind,
        applicationId: input.applicationId,
        reason: error instanceof Error ? error.message.slice(0, 180) : "unknown",
      });
    });
  }
  const config = transactionalEmailConfig();
  if (!config || !validEmail(input.to)) return null;
  const view = applicationNotificationPresentation(input);
  const firstName = input.candidateName?.trim().split(/\s+/)[0] ?? "";
  const greeting = firstName ? `Hello ${firstName},` : "Hello,";
  const messageBlock = input.originalMessage?.trim()
    ? `<div style="margin-top:24px;border:1px solid #dbe5e1;border-radius:14px;background:#f8fafc;padding:18px"><p style="margin:0 0 8px;color:#475569;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Original message${input.originalSubject ? `: ${escapeHtml(input.originalSubject)}` : ""}</p><p style="margin:0;white-space:pre-line;color:#334155;font-size:13px;line-height:21px">${escapeHtml(input.originalMessage).slice(0, 12_000)}</p></div>`
    : "";
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f7f5;font-family:Arial,sans-serif;color:#07111f"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(view.title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f5"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;overflow:hidden;border:1px solid #dbe5e1;border-radius:22px;background:#ffffff"><tr><td style="background:#07111f;padding:22px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#effaf5;padding:3px"><img src="${LOGO_URL}" width="38" height="38" alt="IR35Careers" style="display:block;border:0;border-radius:9px"></td><td style="padding-left:12px;color:#ffffff;font-size:19px;font-weight:700">IR35<span style="color:#a9b8c8;font-weight:600">Careers</span></td></tr></table></td></tr><tr><td style="padding:34px 28px"><p style="margin:0 0 12px;color:${view.accent};font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase">${escapeHtml(view.eyebrow)}</p><h1 style="margin:0;font-size:27px;line-height:35px">${escapeHtml(view.title)}</h1><p style="margin:18px 0 0;color:#334155;font-size:15px;line-height:24px">${escapeHtml(greeting)}</p><p style="margin:12px 0 0;color:#4b5d73;font-size:15px;line-height:24px">${escapeHtml(view.body)}</p>${messageBlock}<a href="${SITE_URL}${view.actionPath}" style="display:inline-block;margin-top:26px;border-radius:11px;background:${view.accent};padding:13px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">${escapeHtml(view.actionLabel)}</a><p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:19px">Application reference: ${escapeHtml(input.applicationId)}</p></td></tr><tr><td style="border-top:1px solid #e2e8f0;background:#f8fafc;padding:18px 28px;color:#64748b;font-size:11px;line-height:18px">IR35Careers keeps application messages linked to the correct role. Review the original employer message before responding.</td></tr></table></td></tr></table></body></html>`;
  const text = [view.eyebrow, "", view.title, "", greeting, view.body, input.originalSubject ? `Original subject: ${input.originalSubject}` : "", input.originalMessage ?? "", "", `${view.actionLabel}: ${SITE_URL}${view.actionPath}`, `Application reference: ${input.applicationId}`].filter(Boolean).join("\n");
  const delivery = await getTransactionalResend(config).emails.send({
    from: config.from,
    to: [input.to],
    subject: view.subject.slice(0, 150),
    html,
    text,
    ...(input.replyTo && validEmail(input.replyTo) ? { replyTo: input.replyTo } : config.replyTo ? { replyTo: config.replyTo } : {}),
    headers: { "X-Entity-Ref-ID": input.idempotencyKey },
    tags: [
      { name: "email_type", value: `application_${input.kind}` },
      { name: "application_ref", value: input.applicationId.slice(0, 36) },
    ],
  }, { idempotencyKey: providerIdempotencyKey(input.idempotencyKey) });
  if (delivery.error) throw new Error(delivery.error.message);
  return delivery.data?.id ?? null;
}
