import { after } from "next/server";
import {
  checkSubmissionWithProvider,
  providerReviewQuestions,
} from "@/lib/application-submission";
import { ensureInboxAlias } from "@/lib/email/inbox-alias";
import { sendApplicationNotification } from "@/lib/email/application-notifications";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  isStaleSubmissionLock,
  submissionRetryAfterSeconds,
} from "@/lib/application-submission-state";
import type {
  ApplicationQuestion,
  ApplicationReceipt,
} from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";
import { buildApplicationAttention } from "@/lib/application-attention";
import { getResend, resendInboundConfig } from "@/lib/email/resend";
import {
  findResendVerificationEmail,
  storeRecoveredVerificationEmail,
} from "@/lib/email/resend-verification-sync";
import { kickApplicationWorker } from "@/lib/application-worker-kick";

export const runtime = "nodejs";
export const maxDuration = 300;

const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function mergeQuestions(
  current: ApplicationQuestion[],
  incoming: ApplicationQuestion[],
): ApplicationQuestion[] {
  const merged = [...current];
  for (const question of incoming) {
    const index = merged.findIndex(
      (item) =>
        item.id === question.id ||
        item.label.toLowerCase() === question.label.toLowerCase(),
    );
    if (index < 0) merged.push(question);
    else
      merged[index] = {
        ...question,
        answer: merged[index].answer.trim() || question.answer,
        reviewed:
          merged[index].reviewed && Boolean(merged[index].answer.trim()),
      };
  }
  return merged;
}

export async function GET(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!token)
    return Response.json(
      { error: "Authentication required." },
      { status: 401, headers: NO_STORE },
    );

  const applicationId =
    new URL(request.url).searchParams.get("applicationId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(applicationId))
    return Response.json(
      { error: "A valid application is required." },
      { status: 400, headers: NO_STORE },
    );

  try {
    const admin = getSupabaseAdmin();
    const { data: authData, error: authError } =
      await admin.auth.getUser(token);
    if (authError || !authData.user)
      return Response.json(
        { error: "Your session is no longer valid." },
        { status: 401, headers: NO_STORE },
      );
    const userId = authData.user.id;
    const [
      { data: submission, error: submissionError },
      { data: packet, error: packetError },
    ] = await Promise.all([
      admin
        .from("application_submissions")
        .select(
          "status, provider_name, provider_submission_id, receipt, error_code, updated_at",
        )
        .eq("application_id", applicationId)
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("application_packets")
        .select("job_snapshot, screening_answers, submission_approved")
        .eq("id", applicationId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (submissionError || packetError)
      throw new Error(submissionError?.message || packetError?.message);
    if (!submission || !packet)
      return Response.json(
        { error: "Application progress was not found." },
        { status: 404, headers: NO_STORE },
      );
    if (submission.status === "succeeded" && submission.receipt)
      return Response.json(
        { state: "submitted", receipt: submission.receipt },
        { headers: NO_STORE },
      );
    if (submission.status === "failed") {
      const stored = submission.receipt as {
        message?: string;
        action?: string;
        attention?: unknown;
      } | null;
      const message =
        stored?.message ||
        "The application stopped before employer confirmation. Your approved materials are safe and ready to retry.";
      const attention =
        stored?.attention && typeof stored.attention === "object"
          ? stored.attention
          : buildApplicationAttention({
              action: stored?.action || "retry",
              message,
            });
      return Response.json(
        {
          state: "failed",
          error: message,
          action: stored?.action || "retry",
          attention,
        },
        { status: 409, headers: NO_STORE },
      );
    }
    if (submission.error_code === "needs_user") {
      const stored = submission.receipt as {
        message?: string;
        action?: string;
        attention?: unknown;
        providerSyncCheckedAt?: string;
      } | null;
      const questions =
        (packet.screening_answers as ApplicationQuestion[]) ?? [];
      if (stored?.action === "verification_code") {
        const lastProviderCheck = new Date(
          stored.providerSyncCheckedAt ?? "",
        ).getTime();
        const providerCheckDue =
          !Number.isFinite(lastProviderCheck) ||
          Date.now() - lastProviderCheck >= 60_000;
        const inbound = providerCheckDue ? resendInboundConfig() : null;
        const inbox = inbound
          ? await ensureInboxAlias(
              admin,
              userId,
              authData.user.email ?? "",
              true,
            )
          : null;
        if (inbound && inbox?.alias) {
          // The recipient is application-scoped, so a wider recovery window is
          // safe and lets an application recover after the user closes the page
          // or an employer delivers its verification email unusually late.
          const requestedAfter = new Date(
            Math.max(
              Date.now() - 24 * 60 * 60_000,
              new Date(submission.updated_at).getTime() - 15 * 60_000,
            ),
          ).toISOString();
          const providerEmail = await findResendVerificationEmail({
            resend: getResend(inbound),
            userId,
            applicationId,
            alias: inbox.alias,
            requestedAfter,
          });
          const checkedAt = new Date().toISOString();
          if (providerEmail) {
            await storeRecoveredVerificationEmail({
              admin,
              userId,
              applicationId,
              email: providerEmail,
            });
            const results = await Promise.all([
              admin
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
                .eq("user_id", userId)
                .eq("application_id", applicationId)
                .in("status", ["needs_user", "failed"]),
              admin
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
                .eq("application_id", applicationId)
                .eq("user_id", userId),
              admin
                .from("application_packets")
                .update({ status: "ready", updated_at: checkedAt })
                .eq("id", applicationId)
                .eq("user_id", userId),
              admin.from("application_events").upsert(
                {
                  user_id: userId,
                  application_id: applicationId,
                  event_type: "status_changed",
                  label: "Employer verification email received",
                  metadata: { action: "verification_code" },
                  idempotency_key: `submit:${applicationId}:verification-recovered:${providerEmail.providerMessageId}`,
                },
                { onConflict: "user_id,idempotency_key" },
              ),
            ]);
            const failure = results.find((result) => result.error)?.error;
            if (failure) throw failure;
            after(() =>
              kickApplicationWorker({
                applicationId,
                reason: "verification_received",
              }).catch((error) =>
                console.warn("verification_received_worker_kick_failed", {
                  applicationId,
                  reason:
                    error instanceof Error
                      ? error.message.slice(0, 240)
                      : "unknown",
                }),
              ),
            );
            return Response.json(
              {
                state: "processing",
                message:
                  "Verification email received. IR35Careers is continuing the application.",
                retryAfterSeconds: 10,
              },
              { status: 202, headers: NO_STORE },
            );
          }
          await admin
            .from("application_submissions")
            .update({
              receipt: { ...stored, providerSyncCheckedAt: checkedAt },
              updated_at: submission.updated_at,
            })
            .eq("application_id", applicationId)
            .eq("user_id", userId);
        }
      }
      const attention =
        stored?.attention && typeof stored.attention === "object"
          ? stored.attention
          : buildApplicationAttention({
              action: stored?.action,
              message: stored?.message,
              questions,
            });
      return Response.json(
        {
          state: "needs_user",
          message:
            stored?.message ||
            "The employer form needs an answer from you before it can continue.",
          action: stored?.action,
          questions,
          attention,
        },
        { status: 202, headers: NO_STORE },
      );
    }
    if (
      submission.error_code !== "needs_user" &&
      isStaleSubmissionLock(submission.updated_at)
    ) {
      const now = new Date().toISOString();
      const staleMessage =
        "The employer portal did not finish in the background. Continue the same approved application on the employer page.";
      const attention = buildApplicationAttention({
        action: "browser_continue",
        message: staleMessage,
      });
      const [
        { error: updateError },
        { error: packetUpdateError },
        { error: eventError },
      ] = await Promise.all([
          admin
            .from("application_submissions")
            .update({
              status: "processing",
              error_code: "needs_user",
              receipt: {
                state: "needs_user",
                message: staleMessage,
                action: "browser_continue",
                attention,
              },
              updated_at: now,
            })
            .eq("application_id", applicationId)
            .eq("user_id", userId),
          admin
            .from("application_packets")
            .update({ status: "needs_review", updated_at: now })
            .eq("id", applicationId)
            .eq("user_id", userId),
          admin
            .from("application_events")
            .upsert(
              {
                user_id: userId,
                application_id: applicationId,
                event_type: "status_changed",
                label: "Application needs secure browser continuation",
                idempotency_key: `submit:${applicationId}:stale:${String(submission.updated_at)}`,
                metadata: { reason: "browser_continue", attention },
              },
              { onConflict: "user_id,idempotency_key" },
            ),
        ]);
      if (updateError || packetUpdateError || eventError)
        throw new Error(
          updateError?.message ||
            packetUpdateError?.message ||
            eventError?.message,
        );
      return Response.json(
        {
          state: "needs_user",
          message: staleMessage,
          action: "browser_continue",
          questions:
            (packet.screening_answers as ApplicationQuestion[]) ?? [],
          attention,
        },
        { status: 202, headers: NO_STORE },
      );
    }
    if (!submission.provider_submission_id) {
      const stored = submission.receipt as {
        message?: string;
        action?: string;
      } | null;
      return Response.json(
        {
          state:
            submission.error_code === "needs_user"
              ? "needs_user"
              : "processing",
          message: stored?.message || "Application is being prepared.",
          action: stored?.action,
          retryAfterSeconds:
            submission.error_code === "needs_user"
              ? undefined
              : submissionRetryAfterSeconds(submission.updated_at),
        },
        { status: 202, headers: NO_STORE },
      );
    }

    const providerReceipt = await checkSubmissionWithProvider(
      String(submission.provider_submission_id),
    );
    const job = packet.job_snapshot as JobDetail;
    const inbox = await ensureInboxAlias(
      admin,
      userId,
      authData.user.email ?? "",
      true,
    );
    const notificationEmail =
      inbox?.forwardingEmail || authData.user.email || "";
    if (providerReceipt.state === "needs_user") {
      const incomingQuestions = providerReviewQuestions(
        providerReceipt.review,
      );
      const questions = mergeQuestions(
        (packet.screening_answers as ApplicationQuestion[]) ?? [],
        incomingQuestions,
      );
      const providerAction =
        providerReceipt.review &&
        typeof providerReceipt.review === "object" &&
        "action" in providerReceipt.review
          ? String(
              (providerReceipt.review as { action?: unknown }).action ?? "",
            )
          : undefined;
      const applicationMaterialsNeedApproval =
        providerAction === "/profile" ||
        incomingQuestions.some(
          (question) => question.required && !question.reviewed,
        );
      const attention = buildApplicationAttention({
        action: providerAction,
        message: providerReceipt.message,
        questions,
      });
      const firstNotice = submission.error_code !== "needs_user";
      const now = new Date().toISOString();
      const [
        { error: updateSubmissionError },
        { error: updatePacketError },
        { error: eventError },
      ] = await Promise.all([
        admin
          .from("application_submissions")
          .update({
            status: "processing",
            error_code: "needs_user",
            receipt: {
              state: "needs_user",
              review: providerReceipt.review ?? null,
              message: providerReceipt.message,
              action: providerAction ?? null,
              attention,
            },
            updated_at: now,
          })
          .eq("application_id", applicationId)
          .eq("user_id", userId),
        admin
          .from("application_packets")
          .update({
            status: "needs_review",
            screening_answers: questions,
            submission_approved: applicationMaterialsNeedApproval
              ? false
              : Boolean(packet.submission_approved),
            updated_at: now,
          })
          .eq("id", applicationId)
          .eq("user_id", userId),
        admin
          .from("application_events")
          .upsert(
            {
              user_id: userId,
              application_id: applicationId,
              event_type: "status_changed",
              label: "Application needs your answer",
              metadata: {
                providerSubmissionId: providerReceipt.providerSubmissionId,
                attention,
              },
              idempotency_key: `submit:${applicationId}:needs-user:${providerReceipt.providerSubmissionId}`,
            },
            { onConflict: "user_id,idempotency_key" },
          ),
      ]);
      if (updateSubmissionError || updatePacketError || eventError)
        throw new Error(
          updateSubmissionError?.message ||
            updatePacketError?.message ||
            eventError?.message,
        );
      if (firstNotice)
        await sendApplicationNotification({
          kind: "needs_attention",
          to: notificationEmail,
          userId,
          inboxAlias: inbox?.alias,
          jobTitle: job.title,
          companyName: job.company_name,
          jobId: job.id,
          applicationId,
          idempotencyKey: `submit:${applicationId}:needs-user:${providerReceipt.providerSubmissionId}`,
        }).catch(() => null);
      return Response.json(
        {
          state: "needs_user",
          message: providerReceipt.message,
          action: providerAction,
          questions,
          attention,
        },
        { status: 202, headers: NO_STORE },
      );
    }
    if (providerReceipt.state === "processing") {
      await admin
        .from("application_submissions")
        .update({
          error_code: null,
          receipt: { state: "processing", message: providerReceipt.message },
          updated_at: new Date().toISOString(),
        })
        .eq("application_id", applicationId)
        .eq("user_id", userId);
      return Response.json(
        { state: "processing", message: providerReceipt.message },
        { status: 202, headers: NO_STORE },
      );
    }

    const receipt: ApplicationReceipt = {
      receiptId: providerReceipt.providerSubmissionId,
      mode: "external_handoff",
      createdAt: providerReceipt.submittedAt,
      destination: job.apply_url,
      reviewedFields: [
        "cv",
        "cover_letter",
        "screening_answers",
        "destination",
      ],
      skippedFields: [],
      message: providerReceipt.message,
    };
    const now = new Date().toISOString();
    const [
      { error: updateSubmissionError },
      { error: updatePacketError },
      { error: eventError },
    ] = await Promise.all([
      admin
        .from("application_submissions")
        .update({
          status: "succeeded",
          receipt,
          error_code: null,
          submitted_at: providerReceipt.submittedAt,
          updated_at: now,
        })
        .eq("application_id", applicationId)
        .eq("user_id", userId),
      admin
        .from("application_packets")
        .update({
          status: "applied",
          mode: "external_handoff",
          receipt,
          updated_at: now,
        })
        .eq("id", applicationId)
        .eq("user_id", userId),
      admin
        .from("application_events")
        .upsert(
          {
            user_id: userId,
            application_id: applicationId,
            event_type: "status_changed",
            label: "Application submitted successfully",
            metadata: {
              providerSubmissionId: providerReceipt.providerSubmissionId,
            },
            idempotency_key: `submit:${applicationId}:event`,
          },
          { onConflict: "user_id,idempotency_key" },
        ),
    ]);
    if (updateSubmissionError || updatePacketError || eventError)
      throw new Error(
        updateSubmissionError?.message ||
          updatePacketError?.message ||
          eventError?.message,
      );
    await sendApplicationNotification({
      kind: "submitted",
      to: notificationEmail,
      userId,
      inboxAlias: inbox?.alias,
      jobTitle: job.title,
      companyName: job.company_name,
      jobId: job.id,
      applicationId,
      idempotencyKey: `submit:${applicationId}:submitted`,
    }).catch(() => null);
    return Response.json(
      { state: "submitted", receipt },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { error: "Application progress could not be refreshed." },
      { status: 502, headers: NO_STORE },
    );
  }
}
