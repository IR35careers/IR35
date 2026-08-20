import { createHash } from "node:crypto";
import { submitWithProvider, submissionProviderConfig } from "@/lib/application-submission";
import { normaliseCoverLetterSignoff, resolveCandidateName } from "@/lib/candidate-name";
import { buildResumePdf } from "@/lib/resume/export";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ApplicationQuestion, ApplicationReceipt, ContractorProfile } from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

type DbRow = Record<string, unknown>;

function approved(row: DbRow): boolean {
  const questions = (row.screening_answers as ApplicationQuestion[]) ?? [];
  return Boolean(row.truth_approved && row.materials_approved && row.submission_approved && questions.every((item) => !item.required || (item.reviewed && item.answer.trim())));
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });
  const provider = submissionProviderConfig();
  if (!provider) return Response.json({ error: "One-click apply is not available for this role yet." }, { status: 503, headers: NO_STORE });

  try {
    const body = (await request.json()) as { applicationId?: string; approval?: string };
    if (!/^[0-9a-f-]{36}$/i.test(body.applicationId ?? "") || body.approval !== "SUBMIT_APPROVED_APPLICATION") {
      return Response.json({ error: "Explicit submission approval is required." }, { status: 400, headers: NO_STORE });
    }

    const admin = getSupabaseAdmin();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return Response.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE });
    const userId = authData.user.id;
    const [{ data: packet, error: packetError }, { data: profileRow, error: profileError }] = await Promise.all([
      admin.from("application_packets").select("*").eq("id", body.applicationId).eq("user_id", userId).maybeSingle(),
      admin.from("profiles").select("application_profile").eq("id", userId).maybeSingle(),
    ]);
    if (packetError || profileError) throw new Error(packetError?.message || profileError?.message);
    if (!packet) return Response.json({ error: "Application packet was not found." }, { status: 404, headers: NO_STORE });
    if (!approved(packet as DbRow)) return Response.json({ error: "Review and approve every required field before submission." }, { status: 409, headers: NO_STORE });

    const job = packet.job_snapshot as JobDetail;
    let destination: string;
    try {
      const parsed = new URL(job.apply_url);
      if (parsed.protocol !== "https:") throw new Error("invalid");
      destination = parsed.toString();
    } catch {
      return Response.json({ error: "This contract has no valid secure application destination." }, { status: 409, headers: NO_STORE });
    }

    const idempotencyKey = `submit:${packet.id}`;
    const { data: previous } = await admin.from("application_submissions").select("status, receipt").eq("user_id", userId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (previous?.status === "succeeded" && previous.receipt) return Response.json({ receipt: previous.receipt, duplicate: true }, { status: 200, headers: NO_STORE });
    if (previous?.status === "processing") return Response.json({ error: "This application is already being submitted." }, { status: 409, headers: NO_STORE });

    const payloadHash = createHash("sha256").update(JSON.stringify({ applicationId: packet.id, updatedAt: packet.updated_at, destination })).digest("hex");
    const { error: queueError } = await admin.from("application_submissions").upsert({
      user_id: userId,
      application_id: packet.id,
      provider_name: provider.name,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
      status: "processing",
      error_code: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,idempotency_key" });
    if (queueError) throw new Error(queueError.message);

    try {
      const candidate = ((profileRow?.application_profile ?? {}) as ContractorProfile);
      const resumeText = String(packet.tailored_cv_text || packet.source_cv_text || "");
      const candidateName = resolveCandidateName(candidate.fullName || "", resumeText);
      if (!candidateName) {
        return Response.json({ error: "Add your full name to your Application Profile or CV before submitting.", action: "/profile" }, { status: 422, headers: NO_STORE });
      }
      const submissionCandidate = { ...candidate, fullName: candidateName };
      const coverLetter = normaliseCoverLetterSignoff(String(packet.cover_letter || ""), candidateName);
      let resumeUrl: string | undefined;
      if (provider.kind === "tsenta") {
        const resumeBuffer = await buildResumePdf({
          format: "pdf",
          resumeText,
          candidateName,
          jobTitle: job.title,
          companyName: job.company_name,
          versionLabel: String(packet.resume_version_label || "Application CV"),
        });
        const storagePath = `${userId}/applications/${packet.id}.pdf`;
        const { error: uploadError } = await admin.storage.from("cvs").upload(storagePath, resumeBuffer, { contentType: "application/pdf", upsert: true });
        if (uploadError) throw new Error("Your approved CV could not be prepared for the employer form.");
        const { data: signedResume, error: signedError } = await admin.storage.from("cvs").createSignedUrl(storagePath, 60 * 60);
        if (signedError || !signedResume?.signedUrl) throw new Error("Your approved CV could not be prepared for the employer form.");
        resumeUrl = signedResume.signedUrl;
      }

      const providerReceipt = await submitWithProvider({
        applicationId: String(packet.id),
        destination,
        job,
        candidate: submissionCandidate,
        resume: { label: String(packet.resume_version_label || "Application CV"), text: resumeText, url: resumeUrl },
        coverLetter,
        screeningAnswers: ((packet.screening_answers as ApplicationQuestion[]) ?? []).map(({ label, answer, source }) => ({ label, answer, source })),
      }, idempotencyKey);
      if (providerReceipt.state !== "submitted") {
        await admin.from("application_submissions").update({
          status: "processing",
          provider_submission_id: providerReceipt.providerSubmissionId,
          error_code: providerReceipt.state === "needs_user" ? "needs_user" : null,
          receipt: { state: providerReceipt.state, review: providerReceipt.review ?? null, message: providerReceipt.message },
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("idempotency_key", idempotencyKey);
        return Response.json({ state: providerReceipt.state, message: providerReceipt.message, review: providerReceipt.review ?? null }, { status: 202, headers: NO_STORE });
      }
      const receipt: ApplicationReceipt = {
        receiptId: providerReceipt.providerSubmissionId,
        mode: "external_handoff",
        createdAt: providerReceipt.submittedAt,
        destination,
        reviewedFields: ["cv", "cover_letter", "screening_answers", "destination"],
        skippedFields: [],
        message: providerReceipt.message,
      };
      const now = new Date().toISOString();
      const [{ error: submissionError }, { error: updateError }, { error: eventError }] = await Promise.all([
        admin.from("application_submissions").update({ status: "succeeded", provider_submission_id: providerReceipt.providerSubmissionId, receipt, submitted_at: providerReceipt.submittedAt, updated_at: now }).eq("user_id", userId).eq("idempotency_key", idempotencyKey),
        admin.from("application_packets").update({ status: "applied", mode: "external_handoff", receipt, updated_at: now }).eq("id", packet.id).eq("user_id", userId),
        admin.from("application_events").upsert({ user_id: userId, application_id: packet.id, event_type: "status_changed", label: "Application submitted through the approved provider", metadata: { providerSubmissionId: providerReceipt.providerSubmissionId }, idempotency_key: `${idempotencyKey}:event` }, { onConflict: "user_id,idempotency_key" }),
      ]);
      if (submissionError || updateError || eventError) throw new Error(submissionError?.message || updateError?.message || eventError?.message);
      return Response.json({ receipt }, { status: 201, headers: NO_STORE });
    } catch (providerError) {
      await admin.from("application_submissions").update({ status: "failed", error_code: "provider_error", updated_at: new Date().toISOString() }).eq("user_id", userId).eq("idempotency_key", idempotencyKey);
      const providerMessage = providerError instanceof Error ? providerError.message : "";
      if (providerMessage.startsWith("Complete your Application Profile")) {
        return Response.json({ error: providerMessage, action: "/profile" }, { status: 422, headers: NO_STORE });
      }
      throw providerError;
    }
  } catch {
    return Response.json({ error: "The application was not submitted. Your approved packet is unchanged." }, { status: 502, headers: NO_STORE });
  }
}
