import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureInboxAlias } from "@/lib/email/inbox-alias";
import { getResend, resendInboundConfig } from "@/lib/email/resend";
import {
  findResendVerificationEmail,
  storeRecoveredVerificationEmail,
} from "@/lib/email/resend-verification-sync";

type PendingVerificationRow = {
  user_id: string;
  application_id: string;
  updated_at: string;
  receipt: {
    action?: string;
    providerSyncCheckedAt?: string;
    [key: string]: unknown;
  } | null;
};

export function verificationRecoveryDue(
  checkedAt: string | undefined,
  nowMs = Date.now(),
): boolean {
  const checkedMs = new Date(checkedAt ?? "").getTime();
  return !Number.isFinite(checkedMs) || nowMs - checkedMs >= 60_000;
}

export function verificationRecoveryRequestedAfter(
  submissionUpdatedAt: string,
  nowMs = Date.now(),
): string {
  const updatedMs = new Date(submissionUpdatedAt).getTime();
  return new Date(
    Math.max(
      nowMs - 24 * 60 * 60_000,
      Number.isFinite(updatedMs) ? updatedMs - 15 * 60_000 : 0,
    ),
  ).toISOString();
}

export async function recoverPendingVerificationEmails(input: {
  admin: SupabaseClient;
  limit?: number;
}): Promise<{ checked: number; recovered: string[] }> {
  const inbound = resendInboundConfig();
  if (!inbound) return { checked: 0, recovered: [] };

  const nowMs = Date.now();
  const checkedAt = new Date(nowMs).toISOString();
  const { data, error } = await input.admin
    .from("application_submissions")
    .select("user_id, application_id, updated_at, receipt")
    .eq("error_code", "needs_user")
    .order("updated_at", { ascending: true })
    .limit(Math.max(1, Math.min(input.limit ?? 20, 50)));
  if (error) throw new Error(error.message);

  const pending = ((data ?? []) as PendingVerificationRow[]).filter(
    (row) =>
      row.receipt?.action === "verification_code" &&
      verificationRecoveryDue(row.receipt.providerSyncCheckedAt, nowMs),
  );
  const recovered: string[] = [];
  let checked = 0;

  for (const row of pending.slice(0, 5)) {
    checked += 1;
    try {
      const auth = await input.admin.auth.admin.getUserById(row.user_id);
      const inbox = await ensureInboxAlias(
        input.admin,
        row.user_id,
        auth.data.user?.email ?? "",
        true,
      );
      if (!inbox?.alias) continue;

      const providerEmail = await findResendVerificationEmail({
        resend: getResend(inbound),
        userId: row.user_id,
        applicationId: row.application_id,
        alias: inbox.alias,
        requestedAfter: verificationRecoveryRequestedAfter(
          row.updated_at,
          nowMs,
        ),
      });

      if (!providerEmail) {
        await input.admin
          .from("application_submissions")
          .update({
            receipt: {
              ...(row.receipt ?? {}),
              providerSyncCheckedAt: checkedAt,
            },
            updated_at: row.updated_at,
          })
          .eq("user_id", row.user_id)
          .eq("application_id", row.application_id)
          .eq("error_code", "needs_user");
        continue;
      }

      await storeRecoveredVerificationEmail({
        admin: input.admin,
        userId: row.user_id,
        applicationId: row.application_id,
        email: providerEmail,
      });
      const results = await Promise.all([
        input.admin
          .from("application_worker_tasks")
          .update({
            status: "queued",
            attempts: 0,
            available_at: checkedAt,
            lease_owner: null,
            lease_expires_at: null,
            last_error: null,
            completed_at: null,
            updated_at: checkedAt,
          })
          .eq("user_id", row.user_id)
          .eq("application_id", row.application_id)
          .in("status", ["needs_user", "failed"]),
        input.admin
          .from("application_submissions")
          .update({
            status: "processing",
            error_code: null,
            receipt: {
              state: "processing",
              action: "verification_code",
              message:
                "Verification email received. IR35Careers is continuing the application.",
            },
            updated_at: checkedAt,
          })
          .eq("user_id", row.user_id)
          .eq("application_id", row.application_id)
          .eq("error_code", "needs_user"),
        input.admin
          .from("application_packets")
          .update({ status: "ready", updated_at: checkedAt })
          .eq("id", row.application_id)
          .eq("user_id", row.user_id),
        input.admin.from("application_events").upsert(
          {
            user_id: row.user_id,
            application_id: row.application_id,
            event_type: "status_changed",
            label: "Employer verification email received",
            metadata: {
              action: "verification_code",
              source: "worker_recovery",
            },
            idempotency_key: `submit:${row.application_id}:verification-recovered:${providerEmail.providerMessageId}`,
          },
          { onConflict: "user_id,idempotency_key", ignoreDuplicates: true },
        ),
      ]);
      const failure = results.find((result) => result.error)?.error;
      if (failure) throw failure;
      recovered.push(row.application_id);
    } catch (error) {
      console.warn("pending_verification_recovery_failed", {
        applicationId: row.application_id,
        reason:
          error instanceof Error ? error.message.slice(0, 240) : "unknown",
      });
    }
  }

  return { checked, recovered };
}
