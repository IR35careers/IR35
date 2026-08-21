import { createHash } from "node:crypto";

export function normaliseReplySubject(value: string): string {
  const subject = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/^(?:\s*re\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 170);
  return `Re: ${subject || "Recruiter message"}`;
}

export function recruiterReplyIdempotencyKey(userId: string, messageId: string, requestKey: string): string {
  const digest = createHash("sha256")
    .update(`${userId}:${messageId}:${requestKey}`)
    .digest("hex");
  return `ir35-recruiter-reply-${digest}`;
}

export function isVerifiedRecruiterRecipient(sender: string, verifiedRecruitmentEmail: string | null | undefined): boolean {
  const bracketed = sender.match(/<([^<>]+)>/)?.[1] ?? sender;
  const candidate = bracketed.trim().toLowerCase();
  const verified = String(verifiedRecruitmentEmail ?? "").trim().toLowerCase();
  return Boolean(
    verified
    && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate)
    && candidate === verified,
  );
}
