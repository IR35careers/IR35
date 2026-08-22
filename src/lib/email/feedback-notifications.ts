import { createHash } from "node:crypto";
import { getTransactionalResend, transactionalEmailConfig } from "@/lib/email/transactional";

const SITE_URL = "https://www.ir35careers.com";
const LOGO_URL = `${SITE_URL}/images/generated/brand/ir35careers-mark-256.png`;
const ADMIN_EMAIL = "ir35careers@gmail.com";

type FeedbackEmailKind = "acknowledgement" | "admin_alert" | "admin_reply" | "resolved";

export interface FeedbackEmailInput {
  kind: FeedbackEmailKind;
  ticketId: string;
  recipient: string;
  customerName?: string;
  subject: string;
  message: string;
  pageUrl?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

function validEmail(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
}

function presentation(input: FeedbackEmailInput) {
  if (input.kind === "admin_alert") return {
    subject: `New customer feedback: ${input.subject}`,
    eyebrow: "New support ticket",
    heading: input.subject,
    body: `A customer has reported an issue in IR35Careers. Review the ticket, reply to the customer and keep its status updated.`,
    action: "Review in admin",
    url: "https://admin.ir35careers.com/?section=feedback",
  };
  if (input.kind === "admin_reply") return {
    subject: `Update on your feedback: ${input.subject}`,
    eyebrow: "Support update",
    heading: "We have an update for you",
    body: input.message,
    action: "View feedback",
    url: `${SITE_URL}/dashboard?feedback=${encodeURIComponent(input.ticketId)}`,
  };
  if (input.kind === "resolved") return {
    subject: `Resolved: ${input.subject}`,
    eyebrow: "Issue resolved",
    heading: "Your feedback has been resolved",
    body: input.message || "The issue you reported has been reviewed and marked as resolved. Thank you for helping us improve IR35Careers.",
    action: "View resolution",
    url: `${SITE_URL}/dashboard?feedback=${encodeURIComponent(input.ticketId)}`,
  };
  return {
    subject: `We received your feedback: ${input.subject}`,
    eyebrow: "Feedback received",
    heading: "Thank you for helping us improve",
    body: "We have received your report and sent it to the IR35Careers support team. We will review it, keep you updated and let you know when it is resolved.",
    action: "View my feedback",
    url: `${SITE_URL}/dashboard?feedback=${encodeURIComponent(input.ticketId)}`,
  };
}

export async function sendFeedbackEmail(input: FeedbackEmailInput): Promise<string | null> {
  const config = transactionalEmailConfig();
  if (!config || !validEmail(input.recipient)) return null;
  const view = presentation(input);
  const firstName = input.customerName?.trim().split(/\s+/)[0] || (input.kind === "admin_alert" ? "Admin" : "there");
  const excerpt = input.kind === "admin_alert" ? `<div style="margin-top:22px;border:1px solid #dbe5e1;border-radius:14px;background:#f8fafc;padding:16px"><p style="margin:0;color:#334155;font-size:13px;line-height:21px;white-space:pre-line">${escapeHtml(input.message).slice(0, 3000)}</p>${input.pageUrl ? `<p style="margin:12px 0 0;color:#64748b;font-size:11px;word-break:break-all">Page: ${escapeHtml(input.pageUrl)}</p>` : ""}</div>` : "";
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f7f5;font-family:Arial,sans-serif;color:#07111f"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(view.heading)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f5"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;overflow:hidden;border:1px solid #dbe5e1;border-radius:22px;background:#fff"><tr><td style="background:#07111f;padding:22px 28px"><table role="presentation"><tr><td style="border-radius:12px;background:#effaf5;padding:3px"><img src="${LOGO_URL}" width="38" height="38" alt="IR35Careers" style="display:block;border-radius:9px"></td><td style="padding-left:12px;color:#fff;font-size:19px;font-weight:700">IR35<span style="color:#a9b8c8">Careers</span></td></tr></table></td></tr><tr><td style="padding:34px 28px"><p style="margin:0 0 12px;color:#087f5b;font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase">${escapeHtml(view.eyebrow)}</p><h1 style="margin:0;font-size:27px;line-height:35px">${escapeHtml(view.heading)}</h1><p style="margin:18px 0 0;color:#334155;font-size:15px;line-height:24px">Hello ${escapeHtml(firstName)},</p><p style="margin:12px 0 0;color:#4b5d73;font-size:15px;line-height:24px;white-space:pre-line">${escapeHtml(view.body)}</p>${excerpt}<a href="${view.url}" style="display:inline-block;margin-top:26px;border-radius:11px;background:#087f5b;padding:13px 20px;color:#fff;text-decoration:none;font-size:14px;font-weight:700">${escapeHtml(view.action)}</a><p style="margin:24px 0 0;color:#64748b;font-size:12px">Ticket reference: ${escapeHtml(input.ticketId)}</p></td></tr><tr><td style="border-top:1px solid #e2e8f0;background:#f8fafc;padding:18px 28px;color:#64748b;font-size:11px;line-height:18px">IR35Careers support updates are linked to your private account.</td></tr></table></td></tr></table></body></html>`;
  const text = `${view.eyebrow}\n\n${view.heading}\n\nHello ${firstName},\n\n${view.body}\n\n${input.kind === "admin_alert" ? input.message : ""}\n\n${view.action}: ${view.url}\nTicket reference: ${input.ticketId}`;
  const key = createHash("sha256").update(`${input.kind}:${input.ticketId}:${input.message}`).digest("hex");
  const delivery = await getTransactionalResend(config).emails.send({
    from: config.from,
    to: [input.recipient],
    subject: view.subject.slice(0, 150),
    html,
    text,
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    headers: { "X-Entity-Ref-ID": `feedback-${input.ticketId}` },
    tags: [{ name: "email_type", value: `feedback_${input.kind}` }],
  }, { idempotencyKey: `ir35-feedback-${key}` });
  if (delivery.error) throw new Error(delivery.error.message);
  return delivery.data?.id ?? null;
}

export async function sendFeedbackCreatedEmails(input: Omit<FeedbackEmailInput, "kind" | "recipient"> & { customerEmail: string }) {
  await Promise.allSettled([
    sendFeedbackEmail({ ...input, kind: "acknowledgement", recipient: input.customerEmail }),
    sendFeedbackEmail({ ...input, kind: "admin_alert", recipient: ADMIN_EMAIL }),
  ]);
}
