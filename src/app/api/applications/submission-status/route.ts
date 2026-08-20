import { checkSubmissionWithProvider } from "@/lib/application-submission";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ApplicationReceipt } from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

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
      admin.from("application_submissions").select("status, provider_submission_id, receipt").eq("application_id", applicationId).eq("user_id", userId).maybeSingle(),
      admin.from("application_packets").select("job_snapshot").eq("id", applicationId).eq("user_id", userId).maybeSingle(),
    ]);
    if (submissionError || packetError) throw new Error(submissionError?.message || packetError?.message);
    if (!submission || !packet) return Response.json({ error: "Application progress was not found." }, { status: 404, headers: NO_STORE });
    if (submission.status === "succeeded" && submission.receipt) return Response.json({ state: "submitted", receipt: submission.receipt }, { headers: NO_STORE });
    if (submission.status === "failed") return Response.json({ state: "failed", error: "The employer form could not be completed. Your approved materials are still saved." }, { status: 409, headers: NO_STORE });
    if (!submission.provider_submission_id) return Response.json({ state: "processing", message: "Application is being prepared." }, { status: 202, headers: NO_STORE });

    const providerReceipt = await checkSubmissionWithProvider(String(submission.provider_submission_id));
    if (providerReceipt.state !== "submitted") {
      await admin.from("application_submissions").update({
        status: "processing",
        error_code: providerReceipt.state === "needs_user" ? "needs_user" : null,
        receipt: { state: providerReceipt.state, review: providerReceipt.review ?? null, message: providerReceipt.message },
        updated_at: new Date().toISOString(),
      }).eq("application_id", applicationId).eq("user_id", userId);
      return Response.json({ state: providerReceipt.state, message: providerReceipt.message, review: providerReceipt.review ?? null }, { status: 202, headers: NO_STORE });
    }

    const job = packet.job_snapshot as JobDetail;
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
      admin.from("application_submissions").update({ status: "succeeded", receipt, submitted_at: providerReceipt.submittedAt, updated_at: now }).eq("application_id", applicationId).eq("user_id", userId),
      admin.from("application_packets").update({ status: "applied", mode: "external_handoff", receipt, updated_at: now }).eq("id", applicationId).eq("user_id", userId),
      admin.from("application_events").upsert({ user_id: userId, application_id: applicationId, event_type: "status_changed", label: "Application submitted", metadata: { providerSubmissionId: providerReceipt.providerSubmissionId }, idempotency_key: `submit:${applicationId}:event` }, { onConflict: "user_id,idempotency_key" }),
    ]);
    if (updateSubmissionError || updatePacketError || eventError) throw new Error(updateSubmissionError?.message || updatePacketError?.message || eventError?.message);
    return Response.json({ state: "submitted", receipt }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Application progress could not be refreshed." }, { status: 502, headers: NO_STORE });
  }
}
