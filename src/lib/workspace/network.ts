import type { NetworkContact } from "@/lib/workspace/types";

export function countDueFollowUps(contacts: NetworkContact[], date = new Date()): number {
  const currentDate = date.toISOString().slice(0, 10);
  return contacts.filter(
    (contact) =>
      Boolean(contact.nextFollowUp) &&
      contact.nextFollowUp <= currentDate &&
      contact.stage !== "closed"
  ).length;
}

export function buildReferralDraft(input: {
  contact: NetworkContact;
  jobTitle?: string;
  company?: string;
  senderName?: string;
}): string {
  const firstName = input.contact.name.trim().split(/\s+/)[0] || input.contact.name;
  const role = input.jobTitle?.trim() || "contract role";
  const company = input.company?.trim() || "your organisation";
  const senderName = input.senderName?.trim() || "[your name]";
  const relationship = input.contact.relationship.trim();
  const context = relationship ? ` Given our ${relationship.toLowerCase()},` : "";

  return `Hi ${firstName},\n\nI hope you’re well. I’m exploring the ${role} contract at ${company}.${context} I wondered whether you would be comfortable sharing any context on the team or referring me if you genuinely think my background is relevant. No pressure at all—I’m happy to apply directly.\n\nThanks,\n${senderName}`;
}
