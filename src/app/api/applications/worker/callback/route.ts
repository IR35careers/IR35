import { after } from "next/server";
import { applicationWorkerConfig } from "@/lib/application-worker-auth";
import {
  ApplicationWorkerRequestError,
  readSignedApplicationWorkerJson,
} from "@/lib/application-worker-request";
import { validApplicationWorkerCallback } from "@/lib/application-worker-types";
import {
  providerReviewAction,
  storeNeedsUser,
  storeSubmittedApplication,
} from "@/lib/application-result-persistence";
import { ensureInboxAlias } from "@/lib/email/inbox-alias";
import type { JobDetail } from "@/lib/job-types";
import { normaliseResumeText } from "@/lib/resume/normalise-text";
import { resolveCandidateName } from "@/lib/candidate-name";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ContractorProfile } from "@/lib/workspace/types";
import {
  clearPortalSession,
  savePortalSession,
} from "@/lib/application-portal-session";
import {
  applicationWorkerCallbackErrorStatus,
  applicationWorkerRetryDelayMs,
  shouldAutomaticallyRetryWorkerAttention,
} from "@/lib/application-worker-retry";
import { kickApplicationWorker } from "@/lib/application-worker-kick";
import { resolveApplicationTaskDestination } from "@/lib/application-worker-destination";

export const runtime = "nodejs";
export const maxDuration = 300;

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function callbackAction(action: string | undefined): string | undefined {
  return action === "source_access_denied" ? "browser_continue" : action;
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!applicationWorkerConfig().enabled)
      return Response.json(
        { error: "The application worker is not enabled." },
        { status: 503, headers: HEADERS },
      );
    const parsed = await readSignedApplicationWorkerJson(request);
    if (!validApplicationWorkerCallback(parsed))
      return Response.json(
        { error: "The worker callback is invalid." },
        { status: 400, headers: HEADERS },
      );

    const callback = parsed;
    const admin = getSupabaseAdmin();
    const [taskResult, packetResult, profileResult, authResult] =
      await Promise.all([
        admin
          .from("application_worker_tasks")
          .select("*")
          .eq("id", callback.taskId)
          .eq("user_id", callback.userId)
          .eq("application_id", callback.applicationId)
          .eq("idempotency_key", callback.idempotencyKey)
          .maybeSingle(),
        admin
          .from("application_packets")
          .select("*")
          .eq("id", callback.applicationId)
          .eq("user_id", callback.userId)
          .maybeSingle(),
        admin
          .from("profiles")
          .select("application_profile")
          .eq("id", callback.userId)
          .maybeSingle(),
        admin.auth.admin.getUserById(callback.userId),
      ]);
    if (taskResult.error || packetResult.error || profileResult.error)
      throw new Error(
        taskResult.error?.message ||
          packetResult.error?.message ||
          profileResult.error?.message,
      );
    if (!taskResult.data || !packetResult.data)
      return Response.json(
        { error: "The application worker task was not found." },
        { status: 404, headers: HEADERS },
      );
    if (taskResult.data.status === "completed")
      return Response.json({ ok: true, duplicate: true }, { headers: HEADERS });

    const callbackDestination = resolveApplicationTaskDestination({
      taskDestination: taskResult.data.destination,
      receiptDestination: callback.receipt?.destination,
    });
    if (!callbackDestination)
      return Response.json(
        { error: "The employer application destination is invalid." },
        { status: 400, headers: HEADERS },
      );

    if (callback.clearPortalSession) {
      await clearPortalSession({
        admin,
        userId: callback.userId,
        applicationId: callback.applicationId,
      });
    } else if (callback.portalSession) {
      await savePortalSession({
        admin,
        userId: callback.userId,
        applicationId: callback.applicationId,
        destinationHost: new URL(callbackDestination).hostname,
        session: callback.portalSession,
      });
    }

    const packet = packetResult.data as Record<string, unknown>;
    const job = packet.job_snapshot as JobDetail;
    const profile = (profileResult.data?.application_profile ??
      {}) as ContractorProfile;
    const resumeText = normaliseResumeText(
      String(packet.tailored_cv_text || packet.source_cv_text || ""),
    );
    const candidateName =
      resolveCandidateName(profile.fullName || "", resumeText) || "Contractor";
    const accountEmail =
      authResult.data.user?.email ||
      profile.forwardingEmail ||
      profile.email ||
      "";
    const inbox = await ensureInboxAlias(
      admin,
      callback.userId,
      accountEmail,
      true,
    );
    const recipient = inbox?.forwardingEmail || accountEmail;
    if (!recipient)
      throw new Error("The contractor notification address is unavailable.");

    if (callback.error) {
      const profileAction =
        callback.error.startsWith("Complete your Application Profile") ||
        callback.error.startsWith("Add your full name");
      await storeNeedsUser({
        admin,
        userId: callback.userId,
        packet,
        job,
        recipient,
        inboxAlias: inbox?.alias,
        candidateName,
        message: profileAction
          ? callback.error
          : "The employer portal stopped before confirmation. Your approved application is saved and can continue securely without starting again.",
        action: profileAction ? "/profile" : "browser_continue",
      });
      await admin
        .from("application_worker_tasks")
        .update({
          status: applicationWorkerCallbackErrorStatus(),
          last_error: callback.error.slice(0, 500),
          lease_owner: null,
          lease_expires_at: null,
          completed_at: callback.completedAt,
          updated_at: callback.completedAt,
        })
        .eq("id", callback.taskId);
      return Response.json(
        { ok: true, state: "needs_user" },
        { headers: HEADERS },
      );
    }

    const receipt = callback.receipt;
    if (!receipt)
      return Response.json(
        { error: "The worker result is missing." },
        { status: 400, headers: HEADERS },
      );
    const resolvedDestination = callbackDestination;
    if (receipt.state === "needs_user") {
      const action = callbackAction(providerReviewAction(receipt));
      if (action === "listing_unavailable") {
        const now = callback.completedAt;
        const jobId = String(job.id || "").trim();
        const updates = [
          admin
            .from("application_submissions")
            .update({
              status: "cancelled",
              error_code: "listing_unavailable",
              receipt: {
                state: "cancelled",
                message:
                  "This role is no longer accepting applications at its original source.",
                action,
              },
              updated_at: now,
            })
            .eq("user_id", callback.userId)
            .eq("idempotency_key", callback.idempotencyKey),
          admin
            .from("application_packets")
            .update({ status: "skipped", updated_at: now })
            .eq("id", callback.applicationId)
            .eq("user_id", callback.userId),
          admin.from("application_events").upsert(
            {
              user_id: callback.userId,
              application_id: callback.applicationId,
              event_type: "status_changed",
              label: "Role no longer accepting applications",
              idempotency_key: `submit:${callback.applicationId}:listing-unavailable`,
              metadata: { action },
            },
            {
              onConflict: "user_id,idempotency_key",
              ignoreDuplicates: true,
            },
          ),
          admin
            .from("application_worker_tasks")
            .update({
              status: "cancelled",
              last_error: null,
              lease_owner: null,
              lease_expires_at: null,
              completed_at: now,
              updated_at: now,
            })
            .eq("id", callback.taskId),
        ];
        if (jobId)
          updates.push(
            admin
              .from("jobs")
              .update({ expired_at: now })
              .eq("id", jobId)
              .is("expired_at", null),
          );
        const results = await Promise.all(updates);
        const failure = results.find((result) => result.error)?.error;
        if (failure) throw failure;
        return Response.json(
          { ok: true, state: "cancelled" },
          { headers: HEADERS },
        );
      }
      const workerAttempts = Number(taskResult.data.attempts ?? 0);
      if (
        shouldAutomaticallyRetryWorkerAttention({
          action,
          attempts: workerAttempts,
        })
      ) {
        const now = callback.completedAt;
        const availableAt = new Date(
          new Date(now).getTime() +
            applicationWorkerRetryDelayMs(workerAttempts),
        ).toISOString();
        const results = await Promise.all([
          admin
            .from("application_submissions")
            .update({
              status: "processing",
              provider_submission_id: receipt.providerSubmissionId,
              error_code: null,
              receipt: {
                state: "processing",
                message:
                  "Waiting for the employer verification email. IR35Careers will check again automatically.",
                action,
                destination: receipt.destination ?? null,
              },
              updated_at: now,
            })
            .eq("user_id", callback.userId)
            .eq("idempotency_key", callback.idempotencyKey),
          admin.from("application_events").upsert(
            {
              user_id: callback.userId,
              application_id: callback.applicationId,
              event_type: "status_changed",
              label: "Waiting for employer verification email",
              idempotency_key: `submit:${callback.applicationId}:verification-wait:${workerAttempts}`,
              metadata: {
                action,
                nextAttemptAt: availableAt,
                workerAttempt: workerAttempts,
              },
            },
            {
              onConflict: "user_id,idempotency_key",
              ignoreDuplicates: true,
            },
          ),
          admin
            .from("application_worker_tasks")
            .update({
              destination: resolvedDestination,
              status: "queued",
              available_at: availableAt,
              last_error: null,
              lease_owner: null,
              lease_expires_at: null,
              completed_at: null,
              updated_at: now,
            })
            .eq("id", callback.taskId),
        ]);
        const failure = results.find((result) => result.error)?.error;
        if (failure) throw failure;
        after(async () => {
          await new Promise((resolve) =>
            setTimeout(resolve, applicationWorkerRetryDelayMs(workerAttempts)),
          );
          await kickApplicationWorker({
            applicationId: callback.applicationId,
            reason: "verification_retry",
          }).catch((error) =>
            console.warn("verification_worker_kick_failed", {
              applicationId: callback.applicationId,
              reason:
                error instanceof Error
                  ? error.message.slice(0, 240)
                  : "unknown",
            }),
          );
        });
        return Response.json(
          { ok: true, state: "processing", availableAt },
          { headers: HEADERS },
        );
      }
      await storeNeedsUser({
        admin,
        userId: callback.userId,
        packet,
        job,
        recipient,
        inboxAlias: inbox?.alias,
        candidateName,
        providerReceipt: receipt,
        message:
          action === "browser_continue"
            ? "The discovery site blocked the hosted worker before the employer page opened. Continue the same approved application securely in desktop Chrome."
            : receipt.message,
        action,
      });
      await admin
        .from("application_worker_tasks")
        .update({
          destination: resolvedDestination,
          status: "needs_user",
          last_error: null,
          lease_owner: null,
          lease_expires_at: null,
          completed_at: callback.completedAt,
          updated_at: callback.completedAt,
        })
        .eq("id", callback.taskId);
      return Response.json(
        { ok: true, state: "needs_user" },
        { headers: HEADERS },
      );
    }
    if (receipt.state === "processing") {
      await Promise.all([
        admin
          .from("application_submissions")
          .update({
            status: "processing",
            provider_submission_id: receipt.providerSubmissionId,
            error_code: null,
            receipt: {
              state: "processing",
              message: receipt.message,
              destination: receipt.destination ?? null,
            },
            updated_at: callback.completedAt,
          })
          .eq("user_id", callback.userId)
          .eq("idempotency_key", callback.idempotencyKey),
        admin
          .from("application_worker_tasks")
          .update({
            destination: resolvedDestination,
            status: "queued",
            available_at: new Date(Date.now() + 20_000).toISOString(),
            lease_owner: null,
            lease_expires_at: null,
            updated_at: callback.completedAt,
          })
          .eq("id", callback.taskId),
      ]);
      return Response.json(
        { ok: true, state: "processing" },
        { headers: HEADERS },
      );
    }

    await storeSubmittedApplication({
      admin,
      userId: callback.userId,
      packet,
      job,
      recipient,
      inboxAlias: inbox?.alias,
      candidateName,
      providerReceipt: receipt,
      destination: resolvedDestination,
    });
    await admin
      .from("application_worker_tasks")
      .update({
        destination: resolvedDestination,
        status: "completed",
        last_error: null,
        lease_owner: null,
        lease_expires_at: null,
        completed_at: callback.completedAt,
        updated_at: callback.completedAt,
      })
      .eq("id", callback.taskId);
    return Response.json(
      { ok: true, state: "submitted" },
      { headers: HEADERS },
    );
  } catch (error) {
    if (error instanceof ApplicationWorkerRequestError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: HEADERS },
      );
    console.error("application_worker_callback_failed", {
      reason: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
    return Response.json(
      { error: "The application worker result could not be saved." },
      { status: 500, headers: HEADERS },
    );
  }
}
