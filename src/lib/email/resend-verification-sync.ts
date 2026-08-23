import type { Resend } from "resend";
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

export async function findResendVerificationEmail(input: {
  resend: Resend;
  userId: string;
  applicationId: string;
  alias: string;
  requestedAfter: string;
}): Promise<ProviderVerificationEmail | null> {
  const requestedAfter = new Date(input.requestedAfter).getTime();
  if (!Number.isFinite(requestedAfter)) return null;

  const listed = await input.resend.emails.receiving.list({ limit: 50 });
  if (listed.error || !listed.data) return null;

  const candidates = listed.data.data
    .filter((item) => new Date(item.created_at).getTime() >= requestedAfter)
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
    .slice(0, 10);

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
