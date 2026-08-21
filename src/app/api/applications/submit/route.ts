import { createHash } from "node:crypto";
import {
  providerReviewQuestions,
  resumeSubmissionWithProvider,
  submitWithProvider,
  submissionProviderConfig,
  type SubmissionProviderReceipt,
} from "@/lib/application-submission";
import { normaliseCoverLetterSignoff, resolveCandidateName } from "@/lib/candidate-name";
import { buildResumePdf } from "@/lib/resume/export";
import { resolveEmployerDestinationForJob } from "@/lib/employer-destinations";
import { submitToVerifiedEmployerEmail } from "@/lib/employer-email-submission";
import { ensureInboxAlias } from "@/lib/email/inbox-alias";
import { sendApplicationNotification } from "@/lib/email/application-notifications";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ApplicationQuestion, ApplicationReceipt, ContractorProfile } from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

type DbRow = Record<string, unknown>;
type AdminClient = ReturnType<typeof getSupabaseAdmin>;

function approved(row: DbRow): boolean {
  const questions = (row.screening_answers as ApplicationQuestion[]) ?? [];
  return Boolean(row.truth_approved && row.materials_approved && row.submission_approved && questions.every((item) => !item.required || (item.reviewed && item.answer.trim())));
}

function mergeQuestions(current: ApplicationQuestion[], incoming: ApplicationQuestion[]): ApplicationQuestion[] {
  const merged = [...current];
  for (const question of incoming) {
    const index = merged.findIndex((item) => item.id === question.id || item.label.toLowerCase() === question.label.toLowerCase());
    if (index < 0) merged.push(question);
    else merged[index] = {
      ...question,
      answer: merged[index].answer.trim() || question.answer,
      reviewed: merged[index].reviewed && Boolean(merged[index].answer.trim()),
    };
  }
  return merged;
}

function knownProviderAnswers(questions: ApplicationQuestion[], candidate: ContractorProfile, packet: DbRow): ApplicationQuestion[] {
  const coverLetter = String(packet.cover_letter ?? "").trim();
  return questions.map((question) => {
    const field = `${question.id} ${question.label}`.toLowerCase();
    let answer = question.answer.trim();
    if (!answer && /cover.?letter/.test(field)) answer = coverLetter;
    else if (!answer && /(notice.?period|available.?to.?start|start.?date)/.test(field)) answer = candidate.availability || candidate.noticePeriod;
    else if (!answer && /linkedin/.test(field)) answer = candidate.linkedInUrl;
    else if (!answer && /(portfolio|personal.?website)/.test(field)) answer = candidate.portfolioUrl;
    else if (!answer && /(current.?location|where.?are.?you.?based)/.test(field)) answer = candidate.location || candidate.city || "";
    else if (!answer && /(right.?to.?work|work.?authori[sz]ation)/.test(field) && candidate.rightToWork !== "prefer_not_to_say") answer = candidate.rightToWork === "yes" ? "Yes" : "No";
    else if (!answer && /sponsorship/.test(field) && candidate.rightToWork !== "prefer_not_to_say") answer = candidate.rightToWork === "needs_sponsorship" ? "Yes" : "No";
    else if (!answer && /relocat/.test(field) && candidate.canRelocate !== null && candidate.canRelocate !== undefined) answer = candidate.canRelocate ? "Yes" : "No";
    else if (!answer && /(work.?in.?person|on.?site|onsite)/.test(field) && candidate.canWorkInPerson !== null && candidate.canWorkInPerson !== undefined) answer = candidate.canWorkInPerson ? "Yes" : "No";
    return answer ? { ...question, answer, reviewed: true, source: "profile" } : question;
  });
}

async function storeNeedsUser(input: {
  admin: AdminClient;
  userId: string;
  packet: DbRow;
  job: JobDetail;
  recipient: string;
  candidateName: string;
  providerReceipt?: SubmissionProviderReceipt;
  message: string;
  action?: string;
}): Promise<ApplicationQuestion[]> {
  const current = ((input.packet.screening_answers as ApplicationQuestion[]) ?? []);
  const incoming = providerReviewQuestions(input.providerReceipt?.review);
  const questions = mergeQuestions(current, incoming);
  const now = new Date().toISOString();
  const idempotencyKey = `submit:${String(input.packet.id)}`;
  const [{ error: packetError }, { error: queueError }, { error: eventError }] = await Promise.all([
    input.admin.from("application_packets").update({
      status: "needs_review",
      screening_answers: questions,
      submission_approved: false,
      updated_at: now,
    }).eq("id", input.packet.id).eq("user_id", input.userId),
    input.admin.from("application_submissions").update({
      status: "processing",
      provider_submission_id: input.providerReceipt?.providerSubmissionId ?? null,
      error_code: "needs_user",
      receipt: { state: "needs_user", review: input.providerReceipt?.review ?? null, message: input.message, action: input.action ?? null },
      updated_at: now,
    }).eq("user_id", input.userId).eq("idempotency_key", idempotencyKey),
    input.admin.from("application_events").upsert({
      user_id: input.userId,
      application_id: input.packet.id,
      event_type: "status_changed",
      label: "Application needs your answer",
      metadata: { questionCount: incoming.length, action: input.action ?? null },
      idempotency_key: `${idempotencyKey}:needs-user:${input.providerReceipt?.providerSubmissionId ?? "profile"}`,
    }, { onConflict: "user_id,idempotency_key" }),
  ]);
  if (packetError || queueError || eventError) throw new Error(packetError?.message || queueError?.message || eventError?.message);
  await sendApplicationNotification({
    kind: "needs_attention",
    to: input.recipient,
    candidateName: input.candidateName,
    jobTitle: input.job.title,
    companyName: input.job.company_name,
    applicationId: String(input.packet.id),
    idempotencyKey: `${idempotencyKey}:needs-user:${input.providerReceipt?.providerSubmissionId ?? "profile"}`,
  }).catch(() => null);
  return questions;
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });

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
    const candidate = ((profileRow?.application_profile ?? {}) as ContractorProfile);
    const resumeText = String(packet.tailored_cv_text || packet.source_cv_text || "");
    const candidateName = resolveCandidateName(candidate.fullName || "", resumeText);
    if (!candidateName) return Response.json({ error: "Add your full name to your Application Profile or CV before submitting.", action: "/profile" }, { status: 422, headers: NO_STORE });

    const accountEmail = authData.user.email || candidate.email || candidate.forwardingEmail || "";
    const inbox = await ensureInboxAlias(admin, userId, accountEmail, true);
    const notificationEmail = inbox?.forwardingEmail || accountEmail;
    const submissionCandidate: ContractorProfile = { ...candidate, fullName: candidateName, email: inbox?.alias || candidate.email || accountEmail };
    const coverLetter = normaliseCoverLetterSignoff(String(packet.cover_letter || ""), candidateName);

    const employerDestination = await resolveEmployerDestinationForJob(job, admin);
    const provider = employerDestination ? null : submissionProviderConfig();
    if (!employerDestination && !provider) return Response.json({ error: "One-click apply is not available for this role yet." }, { status: 503, headers: NO_STORE });
    let destination: string;
    if (employerDestination) destination = `email:${employerDestination.email}`;
    else {
      try {
        const parsed = new URL(job.apply_url);
        if (parsed.protocol !== "https:") throw new Error("invalid");
        destination = parsed.toString();
      } catch {
        return Response.json({ error: "This contract has no valid secure application destination." }, { status: 409, headers: NO_STORE });
      }
    }

    const idempotencyKey = `submit:${packet.id}`;
    const { data: previous } = await admin.from("application_submissions")
      .select("status, receipt, error_code, provider_submission_id")
      .eq("user_id", userId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (previous?.status === "succeeded" && previous.receipt) return Response.json({ receipt: previous.receipt, duplicate: true }, { status: 200, headers: NO_STORE });
    const canResume = previous?.status === "processing" && previous.error_code === "needs_user" && Boolean(previous.provider_submission_id);
    if (previous?.status === "processing" && !canResume && previous.error_code !== "needs_user") {
      return Response.json({ state: "processing", message: "This application is already being completed." }, { status: 202, headers: NO_STORE });
    }

    const payloadHash = createHash("sha256").update(JSON.stringify({ applicationId: packet.id, updatedAt: packet.updated_at, destination })).digest("hex");
    const { error: queueError } = await admin.from("application_submissions").upsert({
      user_id: userId,
      application_id: packet.id,
      provider_name: employerDestination ? "Verified employer email" : provider?.name,
      provider_submission_id: canResume ? previous?.provider_submission_id : null,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
      status: "processing",
      error_code: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,idempotency_key" });
    if (queueError) throw new Error(queueError.message);

    try {
      let resumeUrl: string | undefined;
      let resumeBuffer: Buffer | undefined;
      if (employerDestination || provider?.kind === "tsenta") {
        resumeBuffer = await buildResumePdf({
          format: "pdf",
          resumeText,
          candidateName,
          jobTitle: job.title,
          companyName: job.company_name,
          versionLabel: String(packet.resume_version_label || "Application CV"),
        });
        if (provider?.kind === "tsenta" && !canResume) {
          const storagePath = `${userId}/applications/${packet.id}.pdf`;
          const { error: uploadError } = await admin.storage.from("cvs").upload(storagePath, resumeBuffer, { contentType: "application/pdf", upsert: true });
          if (uploadError) throw new Error("Your approved CV could not be prepared for the employer form.");
          const { data: signedResume, error: signedError } = await admin.storage.from("cvs").createSignedUrl(storagePath, 60 * 60);
          if (signedError || !signedResume?.signedUrl) throw new Error("Your approved CV could not be prepared for the employer form.");
          resumeUrl = signedResume.signedUrl;
        }
      }

      const screeningAnswers = ((packet.screening_answers as ApplicationQuestion[]) ?? []);
      let providerReceipt = canResume
        ? await resumeSubmissionWithProvider(String(previous?.provider_submission_id), screeningAnswers)
        : employerDestination
          ? await submitToVerifiedEmployerEmail({
            applicationId: String(packet.id),
            employerEmail: employerDestination.email,
            job,
            candidate: submissionCandidate,
            candidateName,
            resumePdf: resumeBuffer as Buffer,
            coverLetter,
            screeningAnswers: screeningAnswers.map(({ label, answer }) => ({ label, answer })),
            idempotencyKey,
          })
          : await submitWithProvider({
            applicationId: String(packet.id),
            destination,
            job,
            candidate: submissionCandidate,
            resume: { label: String(packet.resume_version_label || "Application CV"), text: resumeText, url: resumeUrl },
            coverLetter,
            screeningAnswers: screeningAnswers.map(({ label, answer, source }) => ({ label, answer, source })),
          }, idempotencyKey);

      for (let attempt = 0; attempt < 4 && providerReceipt.state === "needs_user"; attempt += 1) {
        const knownAnswers = knownProviderAnswers(providerReviewQuestions(providerReceipt.review), submissionCandidate, packet as DbRow);
        if (knownAnswers.length === 0 || knownAnswers.some((question) => question.required && !question.reviewed)) break;
        providerReceipt = await resumeSubmissionWithProvider(providerReceipt.providerSubmissionId, knownAnswers);
      }

      if (providerReceipt.state === "needs_user") {
        const questions = await storeNeedsUser({ admin, userId, packet: packet as DbRow, job, recipient: notificationEmail, candidateName, providerReceipt, message: providerReceipt.message });
        return Response.json({ state: "needs_user", message: providerReceipt.message, questions }, { status: 202, headers: NO_STORE });
      }
      if (providerReceipt.state === "processing") {
        await admin.from("application_submissions").update({ status: "processing", provider_submission_id: providerReceipt.providerSubmissionId, error_code: null, receipt: { state: "processing", message: providerReceipt.message }, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("idempotency_key", idempotencyKey);
        return Response.json({ state: "processing", message: providerReceipt.message }, { status: 202, headers: NO_STORE });
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
        admin.from("application_submissions").update({ status: "succeeded", provider_submission_id: providerReceipt.providerSubmissionId, receipt, error_code: null, submitted_at: providerReceipt.submittedAt, updated_at: now }).eq("user_id", userId).eq("idempotency_key", idempotencyKey),
        admin.from("application_packets").update({ status: "applied", mode: "external_handoff", receipt, updated_at: now }).eq("id", packet.id).eq("user_id", userId),
        admin.from("application_events").upsert({ user_id: userId, application_id: packet.id, event_type: "status_changed", label: "Application submitted successfully", metadata: { providerSubmissionId: providerReceipt.providerSubmissionId }, idempotency_key: `${idempotencyKey}:event` }, { onConflict: "user_id,idempotency_key" }),
      ]);
      if (submissionError || updateError || eventError) throw new Error(submissionError?.message || updateError?.message || eventError?.message);
      await sendApplicationNotification({ kind: "submitted", to: notificationEmail, candidateName, jobTitle: job.title, companyName: job.company_name, applicationId: String(packet.id), idempotencyKey: `${idempotencyKey}:submitted` }).catch(() => null);
      return Response.json({ receipt }, { status: 201, headers: NO_STORE });
    } catch (providerError) {
      const providerMessage = providerError instanceof Error ? providerError.message : "";
      if (providerMessage.startsWith("Complete your Application Profile")) {
        const questions = await storeNeedsUser({ admin, userId, packet: packet as DbRow, job, recipient: notificationEmail, candidateName, message: providerMessage, action: "/profile" });
        return Response.json({ state: "needs_user", message: providerMessage, questions, action: "/profile" }, { status: 202, headers: NO_STORE });
      }
      await admin.from("application_submissions").update({ status: "failed", error_code: "provider_error", updated_at: new Date().toISOString() }).eq("user_id", userId).eq("idempotency_key", idempotencyKey);
      throw providerError;
    }
  } catch {
    return Response.json({ error: "The application was not submitted. Your approved packet is unchanged." }, { status: 502, headers: NO_STORE });
  }
}
