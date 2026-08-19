import type { ApplicationRecord, InboxClassification } from "@/lib/workspace/types";

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

