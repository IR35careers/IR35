import { checkSubmissionWithProvider, providerReviewQuestions } from "@/lib/application-submission";
import { ensureInboxAlias } from "@/lib/email/inbox-alias";
import { sendApplicationNotification } from "@/lib/email/application-notifications";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isStaleSubmissionLock, submissionRetryAfterSeconds } from "@/lib/application-submission-state";
import type { ApplicationQuestion, ApplicationReceipt } from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function mergeQuestions(current: ApplicationQuestion[], incoming: ApplicationQuestion[]): ApplicationQuestion[] {
  const merged = [...current];
  for (const question of incoming) {
    const index = merged.findIndex((item) => item.id === question.id || item.label.toLowerCase() === question.label.toLowerCase());
    if (index < 0) merged.push(question);
    else merged[index] = { ...question, answer: merged[index].answer.trim() || question.answer, reviewed: merged[index].reviewed && Boolean(merged[index].answer.trim()) };
  }
  return merged;
}

export async function GET(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });

  const applicationId = new URL(request.url).searchParams.get("applicationId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return Response.json({ error: "A valid application is required." }, { status: 400, headers: NO_STORE });

  try {
    const admin = getSupabaseAdmin();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return Response.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE });
    const userId = authData.user.id;
    const [{ data: submission, error: submissionError }, { data: packet, error: packetError }] = await Promise.all([
      admin.from("application_submissions").select("status, provider_name, provider_submission_id, receipt, error_code, updated_at").eq("application_id", applicationId).eq("user_id", userId).maybeSingle(),
      admin.from("application_packets").select("job_snapshot, screening_answers").eq("id", applicationId).eq("user_id", userId).maybeSingle(),
    ]);
    if (submissionError || packetError) throw new Error(submissionError?.message || packetError?.message);
    if (!submission || !packet) return Response.json({ error: "Application progress was not found." }, { status: 404, headers: NO_STORE });
    if (submission.status === "succeeded" && submission.receipt) return Response.json({ state: "submitted", receipt: submission.receipt }, { headers: NO_STORE });
    if (submission.status === "failed") return Response.json({ state: "failed", error: "The employer form could not be completed. Your approved materials are still saved." }, { status: 409, headers: NO_STORE });
    if (submission.error_code === "needs_user") {
      const stored = submission.receipt as { message?: string; action?: string } | null;
      return Response.json({
        state: "needs_user",
        message: stored?.message || "The employer form needs an answer from you before it can continue.",
        action: stored?.action,
        questions: (packet.screening_answers as ApplicationQuestion[]) ?? [],
      }, { status: 202, headers: NO_STORE });
    }
    if (submission.error_code !== "needs_user" && isStaleSubmissionLock(submission.updated_at)) {
      const now = new Date().toISOString();
      const [{ error: updateError }, { error: eventError }] = await Promise.all([
        admin.from("application_submissions").update({ status: "failed", error_code: "stale_processing", receipt: { state: "failed", message: "The previous runner stopped before employer confirmation." }, updated_at: now }).eq("application_id", applicationId).eq("user_id", userId),
        admin.from("application_events").upsert({ user_id: userId, application_id: applicationId, event_type: "status_changed", label: "Application attempt stopped and is ready to retry", idempotency_key: `submit:${applicationId}:stale:${String(submission.updated_at)}` }, { onConflict: "user_id,idempotency_key" }),
      ]);
      if (updateError || eventError) throw new Error(updateError?.message || eventError?.message);
      return Response.json({ state: "failed", error: "The previous application attempt stopped before employer confirmation. Your approved materials are safe. Select Apply again to retry." }, { status: 409, headers: NO_STORE });
    }
    if (!submission.provider_submission_id) {
      const stored = submission.receipt as { message?: string; action?: string } | null;
      return Response.json({
        state: submission.error_code === "needs_user" ? "needs_user" : "processing",
        message: stored?.message || "Application is being prepared.",
        action: stored?.action,
        retryAfterSeconds: submission.error_code === "needs_user" ? undefined : submissionRetryAfterSeconds(submission.updated_at),
      }, { status: 202, headers: NO_STORE });
    }

    const providerReceipt = await checkSubmissionWithProvider(String(submission.provider_submission_id));
    const job = packet.job_snapshot as JobDetail;
    const inbox = await ensureInboxAlias(admin, userId, authData.user.email ?? "", true);
    const notificationEmail = inbox?.forwardingEmail || authData.user.email || "";
    if (providerReceipt.state === "needs_user") {
      const questions = mergeQuestions((packet.screening_answers as ApplicationQuestion[]) ?? [], providerReviewQuestions(providerReceipt.review));
      const firstNotice = submission.error_code !== "needs_user";
      const now = new Date().toISOString();
      const [{ error: updateSubmissionError }, { error: updatePacketError }, { error: eventError }] = await Promise.all([
        admin.from("application_submissions").update({ status: "processing", error_code: "needs_user", receipt: { state: "needs_user", review: providerReceipt.review ?? null, message: providerReceipt.message }, updated_at: now }).eq("application_id", applicationId).eq("user_id", userId),
        admin.from("application_packets").update({ status: "needs_review", screening_answers: questions, submission_approved: false, updated_at: now }).eq("id", applicationId).eq("user_id", userId),
        admin.from("application_events").upsert({ user_id: userId, application_id: applicationId, event_type: "status_changed", label: "Application needs your answer", metadata: { providerSubmissionId: providerReceipt.providerSubmissionId }, idempotency_key: `submit:${applicationId}:needs-user:${providerReceipt.providerSubmissionId}` }, { onConflict: "user_id,idempotency_key" }),
      ]);
      if (updateSubmissionError || updatePacketError || eventError) throw new Error(updateSubmissionError?.message || updatePacketError?.message || eventError?.message);
      if (firstNotice) await sendApplicationNotification({ kind: "needs_attention", to: notificationEmail, userId, inboxAlias: inbox?.alias, jobTitle: job.title, companyName: job.company_name, applicationId, idempotencyKey: `submit:${applicationId}:needs-user:${providerReceipt.providerSubmissionId}` }).catch(() => null);
      return Response.json({ state: "needs_user", message: providerReceipt.message, questions }, { status: 202, headers: NO_STORE });
    }
    if (providerReceipt.state === "processing") {
      await admin.from("application_submissions").update({ error_code: null, receipt: { state: "processing", message: providerReceipt.message }, updated_at: new Date().toISOString() }).eq("application_id", applicationId).eq("user_id", userId);
      return Response.json({ state: "processing", message: providerReceipt.message }, { status: 202, headers: NO_STORE });
    }

    const receipt: ApplicationReceipt = {
      receiptId: providerReceipt.providerSubmissionId,
      mode: "external_handoff",
      createdAt: providerReceipt.submittedAt,
      destination: job.apply_url,
      reviewedFields: ["cv", "cover_letter", "screening_answers", "destination"],
      skippedFields: [],
      message: providerReceipt.message,
    };
    const now = new Date().toISOString();
    const [{ error: updateSubmissionError }, { error: updatePacketError }, { error: eventError }] = await Promise.all([
      admin.from("application_submissions").update({ status: "succeeded", receipt, error_code: null, submitted_at: providerReceipt.submittedAt, updated_at: now }).eq("application_id", applicationId).eq("user_id", userId),
      admin.from("application_packets").update({ status: "applied", mode: "external_handoff", receipt, updated_at: now }).eq("id", applicationId).eq("user_id", userId),
      admin.from("application_events").upsert({ user_id: userId, application_id: applicationId, event_type: "status_changed", label: "Application submitted successfully", metadata: { providerSubmissionId: providerReceipt.providerSubmissionId }, idempotency_key: `submit:${applicationId}:event` }, { onConflict: "user_id,idempotency_key" }),
    ]);
    if (updateSubmissionError || updatePacketError || eventError) throw new Error(updateSubmissionError?.message || updatePacketError?.message || eventError?.message);
    await sendApplicationNotification({ kind: "submitted", to: notificationEmail, userId, inboxAlias: inbox?.alias, jobTitle: job.title, companyName: job.company_name, applicationId, idempotencyKey: `submit:${applicationId}:submitted` }).catch(() => null);
    return Response.json({ state: "submitted", receipt }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Application progress could not be refreshed." }, { status: 502, headers: NO_STORE });
  }
}
