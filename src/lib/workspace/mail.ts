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
  if (/\b(unfortunately|regret to inform|not progressing|not moving forward|will not be progressing|unsuccessful|other candidates|position has been filled|role has been filled|application has been declined|application was declined)\b/.test(text)) return "rejection";
  if (/\b(interview|schedule a call|book a call|availability for a call|meet the team|technical call|screening call|interview slot|interview invitation)\b/.test(text)) return "interview";
  if (/\b(action required|please confirm|complete your|more information|right to work|working pattern|availability|assessment|coding test|technical test|take home (?:task|exercise)|online test|psychometric|verification code|verify your (?:email|identity|account)|one time (?:passcode|password)|security code|otp|upload (?:a |your )?(?:document|documents|identification|id))\b/.test(text)) return "action_required";
  if (/\b(application received|application submitted|application update|under review|viewed your application|status update|thanks? for applying|thank you for applying|we received your application|submission confirmation|pleased to offer|would like to offer|formal offer|contract offer|offer letter)\b/.test(text)) return "application_update";
  return "other";
}

/**
 * Job boards often send recommendation newsletters to an application alias
 * after it has been used on their site. These are not recruiter responses and
 * should not appear beside application confirmations or interview messages.
 */
export function isUnsolicitedJobMarketingMessage(
  subject: string,
  body: string,
  sender = "",
): boolean {
  const subjectText = normalise(subject);
  const text = normalise(`${subject} ${body}`);
  const senderText = sender.toLowerCase();

  const applicationResponse = /\b(application (?:received|submitted|update|status)|thanks? for applying|thank you for applying|interview|assessment|verification code|action required|unfortunately|not progressing|offer letter|contract offer)\b/.test(
    text,
  );
  if (applicationResponse) return false;

  const recommendationSubject = /\b(?:our |your )?recommendation(?:s)?\b|\brecommended jobs?\b|\bjobs? (?:picked|selected) for you\b|\bjob alerts?\b|\bsimilar jobs?\b|\bnew jobs? for you\b|\blatest (?:job )?matches\b|^\d+ new\b.*\bjobs?\b/.test(
    subjectText,
  );
  const recommendationBody = /\bwe recommend this job for you\b|\btake a look and see if you want to apply\b|\bjobs? matching your (?:profile|search)\b|\bmore jobs? like this\b|\bcheck out your latest matches\b|\bwe found these new jobs\b|\bmatch your search for\b|\bmanage (?:your )?(?:job )?alerts\b/.test(
    text,
  );
  const knownJobAlertSender = /@(?:[a-z0-9-]+\.)*(?:totaljobsmail\.com|jobsite\.co\.uk)$|totaljobsmail\.com/.test(
    senderText,
  );
  const genericMarketingSender = /(?:^|[.@_-])(?:job|jobs|alerts?|recommendations?|newsletter)(?:[.@_-]|$)/.test(
    senderText,
  );
  const newsletterControl = /\b(?:unsubscribe|email preferences|manage (?:your )?(?:emails|alerts|preferences))\b/.test(text);
  const permanentPromotion =
    /\bpermanent\b/.test(text) &&
    /\b(?:good fit|recommended|recommendation|take a look|job alert)\b/.test(text);

  return (
    knownJobAlertSender ||
    recommendationSubject ||
    recommendationBody ||
    (genericMarketingSender && (newsletterControl || permanentPromotion))
  );
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
