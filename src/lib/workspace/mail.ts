import type { ApplicationRecord, InboxClassification, InboxMessage } from "@/lib/workspace/types";

export type InboxViewCategory =
  | "verification"
  | "rejection"
  | "interview"
  | "assessment"
  | "reminder"
  | "offer"
  | "applied"
  | "retry"
  | "needs_you"
  | "other";

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9£]+/g, " ").replace(/\s+/g, " ").trim();
}

export function classifyInboundMessage(subject: string, body: string): InboxClassification {
  const text = normalise(`${subject} ${body}`);
  if (/\b(interview|schedule a call|book a call|availability for a call|meet the team|technical call)\b/.test(text)) return "interview";
  if (/\b(unfortunately|not progressing|not moving forward|unsuccessful|other candidates|position has been filled)\b/.test(text)) return "rejection";
  if (/\b(action required|please confirm|complete your|more information|right to work|working pattern|availability)\b/.test(text)) return "action_required";
  if (/\b(application received|application update|under review|viewed your application|status update)\b/.test(text)) return "application_update";
  return "other";
}

/**
 * Presentation-only categories for the contractor inbox. The database keeps
 * its conservative five-value classification while the UI can distinguish
 * common application messages without requiring a destructive migration.
 */
export function inboxViewCategory(message: Pick<InboxMessage, "subject" | "body" | "preview" | "classification">): InboxViewCategory {
  const text = normalise(`${message.subject} ${message.preview} ${message.body}`);
  if (message.classification === "rejection") return "rejection";
  if (/\b(offer of employment|contract offer|formal offer|pleased to offer|would like to offer|offer letter)\b/.test(text)) return "offer";
  if (message.classification === "interview") return "interview";
  if (/\b(verification code|verify your (?:email|identity|account)|one time passcode|one time password|security code|otp)\b/.test(text)) return "verification";
  if (/\b(assessment|coding test|technical test|take home task|take home exercise|online test|psychometric)\b/.test(text)) return "assessment";
  if (/\b(reminder|deadline|due by|complete by|expires? (?:today|tomorrow|soon))\b/.test(text)) return "reminder";
  if (/\b(application (?:has been )?(?:received|submitted)|thanks? for applying|thank you for applying|submission confirmation|we received your application)\b/.test(text)) return "applied";
  if (/\b(application (?:needs (?:review|another attempt)|ready to retry)|select apply again|approved cv and answers are saved)\b/.test(text)) return "retry";
  if (message.classification === "action_required") return "needs_you";
  return "other";
}

export function inboxViewCategoryLabel(category: InboxViewCategory): string {
  if (category === "needs_you") return "Needs you";
  return `${category.slice(0, 1).toUpperCase()}${category.slice(1)}`;
}

export function findLinkedApplication(
  subject: string,
  body: string,
  applications: Array<Pick<ApplicationRecord, "id" | "job">>
): string | null {
  const text = normalise(`${subject} ${body}`);
  let best: { id: string; score: number } | null = null;
  for (const application of applications) {
    const company = normalise(application.job.company_name);
    const titleTerms = normalise(application.job.title).split(" ").filter((term) => term.length >= 4);
    const score = (company && text.includes(company) ? 4 : 0) + titleTerms.filter((term) => text.includes(term)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: application.id, score };
  }
  return best?.id ?? null;
}
