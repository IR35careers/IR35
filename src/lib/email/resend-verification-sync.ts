import type { ListReceivingEmail, Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractEmailVerificationCode } from "@/lib/email/verification-code";
import {
  extractEmailAddress,
  htmlToPlainText,
} from "@/lib/email/resend";
import { verificationRecipientMatches } from "@/lib/email/wait-for-verification-code";

export interface ProviderVerificationEmail {
  code: string;
  providerMessageId: string;
  sender: string;
  recipient: string;
  subject: string;
  text: string;
  receivedAt: string;
}

export async function storeRecoveredVerificationEmail(input: {
  admin: SupabaseClient;
  userId: string;
  applicationId: string;
  email: ProviderVerificationEmail;
}): Promise<void> {
  const stored = await input.admin.from("inbox_messages").upsert(
    {
      user_id: input.userId,
      application_id: input.applicationId,
      provider_message_id: input.email.providerMessageId,
      sender: input.email.sender,
      recipient: input.email.recipient,
      subject: input.email.subject,
      body_text: input.email.text,
      preview: input.email.text.replace(/\s+/g, " ").slice(0, 220),
      classification: "other",
      received_at: input.email.receivedAt,
    },
    {
      onConflict: "user_id,provider_message_id",
      ignoreDuplicates: true,
    },
  );
  if (stored.error) throw stored.error;
}

export async function findResendVerificationEmail(input: {
  resend: Resend;
  userId: string;
  applicationId: string;
  alias: string;
  requestedAfter: string;
}): Promise<ProviderVerificationEmail | null> {
  const requestedAfter = new Date(input.requestedAfter).getTime();
  if (!Number.isFinite(requestedAfter)) return null;

  // Provider timestamps can be a little earlier than the worker clock. The
  // application-scoped recipient keeps this small allowance unambiguous.
  const earliestAcceptedAt = requestedAfter - 5 * 60_000;
  const receivedItems: ListReceivingEmail[] = [];
  let after: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const listed = await input.resend.emails.receiving.list({
      limit: 100,
      ...(after ? { after } : {}),
    });
    if (listed.error || !listed.data) {
      if (page === 0) return null;
      break;
    }
    const pageItems = listed.data.data;
    receivedItems.push(...pageItems);
    if (!listed.data.has_more || pageItems.length === 0) break;
    const oldestOnPage = Math.min(
      ...pageItems.map((item) => new Date(item.created_at).getTime()),
    );
    if (
      Number.isFinite(oldestOnPage) &&
      oldestOnPage < earliestAcceptedAt
    )
      break;
    after = pageItems[pageItems.length - 1]?.id;
    if (!after) break;
  }

  const candidates = receivedItems
    .filter((item) => new Date(item.created_at).getTime() >= earliestAcceptedAt)
    .filter((item) =>
      [...(item.to ?? []), ...(item.received_for ?? [])].some((value) => {
        const recipient = extractEmailAddress(String(value));
        return (
          recipient &&
          verificationRecipientMatches({
            actual: recipient,
            expected: input.alias,
            applicationId: input.applicationId,
          })
        );
      }),
    )
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime(),
    )
    .slice(0, 30);

  for (const candidate of candidates) {
    const received = await input.resend.emails.receiving.get(candidate.id, {
      html_format: "cid",
    });
    if (received.error || !received.data) continue;
    const recipient = [...received.data.to, ...received.data.received_for]
      .map((value) => extractEmailAddress(String(value)))
      .find(
        (value) =>
          value &&
          verificationRecipientMatches({
            actual: value,
            expected: input.alias,
            applicationId: input.applicationId,
          }),
      );
    if (!recipient) continue;
    const text =
      received.data.text?.trim() || htmlToPlainText(received.data.html ?? "");
    const code = extractEmailVerificationCode(
      received.data.subject,
      text,
    );
    if (!code) continue;
    return {
      code,
      providerMessageId: `resend:${received.data.id}`,
      sender: String(received.data.from ?? "").slice(0, 254),
      recipient,
      subject: String(received.data.subject ?? "").slice(0, 500),
      text: text.slice(0, 100_000),
      receivedAt: new Date(received.data.created_at).toISOString(),
    };
  }

  return null;
}
