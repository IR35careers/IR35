import type { SupabaseClient } from "@supabase/supabase-js";
import { extractEmailVerificationCode } from "@/lib/email/verification-code";
import { parseApplicationInboxAlias } from "@/lib/email/inbox-alias";

export function verificationRecipientMatches(input: {
  actual: string;
  expected?: string;
  applicationId: string;
}): boolean {
  if (!input.expected) return true;
  const actual = input.actual.trim().toLowerCase();
  const expected = input.expected.trim().toLowerCase();
  if (actual === expected) return true;
  const parsed = parseApplicationInboxAlias(actual);
  return Boolean(
    parsed.applicationId === input.applicationId &&
      parseApplicationInboxAlias(expected).baseAlias === parsed.baseAlias,
  );
}

export async function waitForEmailVerificationCode(input: {
  admin: SupabaseClient;
  userId: string;
  applicationId: string;
  alias?: string;
  requestedAfter: string;
  attempts?: number;
  intervalMs?: number;
}): Promise<string | null> {
  const attempts = Math.max(1, Math.min(input.attempts ?? 12, 40));
  const intervalMs = Math.max(250, Math.min(input.intervalMs ?? 3_000, 10_000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data, error } = await input.admin
      .from("inbox_messages")
      .select("application_id, recipient, subject, body_text, received_at")
      .eq("user_id", input.userId)
      .gte("received_at", input.requestedAfter)
      .order("received_at", { ascending: false })
      .limit(30);
    if (error) return null;
    for (const row of data ?? []) {
      if (
        !verificationRecipientMatches({
          actual: String(row.recipient ?? ""),
          expected: input.alias,
          applicationId: input.applicationId,
        })
      )
        continue;
      if (
        row.application_id &&
        String(row.application_id) !== input.applicationId
      )
        continue;
      const code = extractEmailVerificationCode(
        String(row.subject ?? ""),
        String(row.body_text ?? ""),
      );
      if (code) return code;
    }
    if (attempt < attempts - 1)
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}
