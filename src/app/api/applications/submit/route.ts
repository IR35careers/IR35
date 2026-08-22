import { createHash, createHmac } from "node:crypto";
import { after } from "next/server";
import {
  providerReviewQuestions,
  resumeSubmissionWithProvider,
  submitWithProvider,
  submissionProviderConfig,
  type SubmissionProviderReceipt,
} from "@/lib/application-submission";
import {
  normaliseCoverLetterSignoff,
  resolveCandidateName,
} from "@/lib/candidate-name";
import { buildResumePdf } from "@/lib/resume/export";
import { normaliseResumeText } from "@/lib/resume/normalise-text";
import { resolveEmployerDestinationForJob } from "@/lib/employer-destinations";
import { submitToVerifiedEmployerEmail } from "@/lib/employer-email-submission";
import { ensureInboxAlias } from "@/lib/email/inbox-alias";
import { sendApplicationNotification } from "@/lib/email/application-notifications";
import { extractEmailVerificationCode } from "@/lib/email/verification-code";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  isStaleSubmissionLock,
  submissionRetryAfterSeconds,
} from "@/lib/application-submission-state";
import {
  approvedApplicationPacketRow,
  InvalidApplicationPacketError,
  normaliseApprovedApplicationPacket,
} from "@/lib/application-packet-snapshot";
import type {
  ApplicationQuestion,
  ApplicationReceipt,
  ApplicationRecord,
  ContractorProfile,
} from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { buildApplicationAttention } from "@/lib/application-attention";
import { applicationSubmissionFailure } from "@/lib/application-submission-failure";
import { evaluateProfileReadiness } from "@/lib/workspace/profile-readiness";
import {
  clearPortalSession,
  loadPortalSession,
  savePortalSession,
} from "@/lib/application-portal-session";

export const runtime = "nodejs";
export const maxDuration = 300;

const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

type DbRow = Record<string, unknown>;
type AdminClient = ReturnType<typeof getSupabaseAdmin>;

function portalPassword(
  userId: string,
  destination: string,
): string | undefined {
  const secret =
    process.env.APPLICATION_ACCOUNT_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) return undefined;
  const hostname = new URL(destination).hostname.toLowerCase();
  const token = createHmac("sha256", secret)
    .update(`${userId}:${hostname}:portal-v1`)
    .digest("base64url")
    .slice(0, 18);
  return `Ir35!${token}a7`;
}

async function waitForEmailVerificationCode(input: {
  admin: AdminClient;
  userId: string;
  applicationId: string;
  alias?: string;
  requestedAfter: string;
}): Promise<string | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await input.admin
      .from("inbox_messages")
      .select("application_id, recipient, subject, body_text, received_at")
      .eq("user_id", input.userId)
      .gte("received_at", input.requestedAfter)
      .order("received_at", { ascending: false })
      .limit(20);
    if (error) return null;
    for (const row of data ?? []) {
      if (
        input.alias &&
        String(row.recipient ?? "").toLowerCase() !== input.alias.toLowerCase()
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
    if (attempt < 11)
      await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return null;
}

async function saveApprovedPacket(input: {
  admin: AdminClient;
  userId: string;
  applicationId: string;
  packet: unknown;
}): Promise<void> {
  const snapshot = normaliseApprovedApplicationPacket(
    input.packet,
    input.applicationId,
  );
  const [
    { data: existing, error: existingError },
    { data: trustedJobRow, error: jobError },
  ] = await Promise.all([
    input.admin
      .from("application_packets")
      .select("id, user_id")
      .eq("id", input.applicationId)
      .maybeSingle(),
    input.admin
      .from("jobs")
      .select("*")
      .eq("id", snapshot.job.id)
      .maybeSingle(),
  ]);
  if (existingError || jobError)
    throw new Error(existingError?.message || jobError?.message);
  if (existing && existing.user_id !== input.userId)
    throw new InvalidApplicationPacketError();
  if (!trustedJobRow)
    throw new InvalidApplicationPacketError(
      "This contract is no longer available in the live job feed.",
    );

  const trustedJob = { ...snapshot.job, ...(trustedJobRow as JobDetail) };
  const row = approvedApplicationPacketRow(snapshot, input.userId, trustedJob);
  const result = existing
    ? await input.admin
        .from("application_packets")
        .update(row)
        .eq("id", input.applicationId)
        .eq("user_id", input.userId)
    : await input.admin.from("application_packets").insert(row);
  if (result.error) throw new Error(result.error.message);

  const { error: eventError } = await input.admin
    .from("application_events")
    .upsert(
      {
        user_id: input.userId,
        application_id: input.applicationId,
        event_type: "approved",
        label: "Application approved and ready to submit",
        idempotency_key: `submit:${input.applicationId}:approved`,
      },
      { onConflict: "user_id,idempotency_key" },
    );
  if (eventError) throw new Error(eventError.message);
}

function approved(row: DbRow): boolean {
  const questions = (row.screening_answers as ApplicationQuestion[]) ?? [];
  return Boolean(
    row.truth_approved &&
    row.materials_approved &&
    row.submission_approved &&
    questions.every(
      (item) => !item.required || (item.reviewed && item.answer.trim()),
    ),
  );
}

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

function providerReviewAction(
  receipt: SubmissionProviderReceipt | undefined,
): string | undefined {
  if (!receipt?.review || typeof receipt.review !== "object") return undefined;
  const action = (receipt.review as Record<string, unknown>).action;
  return typeof action === "string" && action.trim()
    ? action.trim().slice(0, 80)
    : undefined;
}

function safeSubmissionError(error: unknown): string {
  return applicationSubmissionFailure(error).message;
}

function knownProviderAnswers(
  questions: ApplicationQuestion[],
  candidate: ContractorProfile,
  packet: DbRow,
): ApplicationQuestion[] {
  const coverLetter = String(packet.cover_letter ?? "").trim();
  return questions.map((question) => {
    const field = `${question.id} ${question.label}`.toLowerCase();
    let answer = question.answer.trim();
    if (!answer && /cover.?letter/.test(field)) answer = coverLetter;
    else if (
      !answer &&
      /(notice.?period|available.?to.?start|start.?date)/.test(field)
    )
      answer = candidate.availability || candidate.noticePeriod;
    else if (!answer && /linkedin/.test(field)) answer = candidate.linkedInUrl;
    else if (!answer && /(portfolio|personal.?website)/.test(field))
      answer = candidate.portfolioUrl;
    else if (
      !answer &&
      /(current.?location|where.?are.?you.?based)/.test(field)
    )
      answer = candidate.location || candidate.city || "";
    else if (
      !answer &&
      /(right.?to.?work|work.?authori[sz]ation)/.test(field) &&
      candidate.rightToWork !== "prefer_not_to_say"
    )
      answer = candidate.rightToWork === "yes" ? "Yes" : "No";
    else if (
      !answer &&
      /sponsorship/.test(field) &&
      candidate.rightToWork !== "prefer_not_to_say"
    )
      answer = candidate.rightToWork === "needs_sponsorship" ? "Yes" : "No";
    else if (
      !answer &&
      /relocat/.test(field) &&
      candidate.canRelocate !== null &&
      candidate.canRelocate !== undefined
    )
      answer = candidate.canRelocate ? "Yes" : "No";
    else if (
      !answer &&
      /(work.?in.?person|on.?site|onsite)/.test(field) &&
      candidate.canWorkInPerson !== null &&
      candidate.canWorkInPerson !== undefined
    )
      answer = candidate.canWorkInPerson ? "Yes" : "No";
    return answer
      ? { ...question, answer, reviewed: true, source: "profile" }
      : question;
  });
}

async function storeNeedsUser(input: {
  admin: AdminClient;
  userId: string;
  packet: DbRow;
  job: JobDetail;
  recipient: string;
  inboxAlias?: string;
  candidateName: string;
  providerReceipt?: SubmissionProviderReceipt;
  message: string;
  action?: string;
}): Promise<ApplicationQuestion[]> {
  const current =
    (input.packet.screening_answers as ApplicationQuestion[]) ?? [];
  const incoming = providerReviewQuestions(input.providerReceipt?.review);
  const questions = mergeQuestions(current, incoming);
  const attention = buildApplicationAttention({
    action: input.action,
    message: input.message,
    questions: incoming.length ? incoming : questions,
  });
  const now = new Date().toISOString();
  const idempotencyKey = `submit:${String(input.packet.id)}`;
  const [{ error: packetError }, { error: queueError }, { error: eventError }] =
    await Promise.all([
      input.admin
        .from("application_packets")
        .update({
          status: "needs_review",
          screening_answers: questions,
          submission_approved: false,
          updated_at: now,
        })
        .eq("id", input.packet.id)
        .eq("user_id", input.userId),
      input.admin
        .from("application_submissions")
        .update({
          status: "processing",
          provider_submission_id:
            input.providerReceipt?.providerSubmissionId ?? null,
          error_code: "needs_user",
          receipt: {
            state: "needs_user",
            review: input.providerReceipt?.review ?? null,
            message: input.message,
            action: input.action ?? null,
            attention,
          },
          updated_at: now,
        })
        .eq("user_id", input.userId)
        .eq("idempotency_key", idempotencyKey),
      input.admin.from("application_events").upsert(
        {
          user_id: input.userId,
          application_id: input.packet.id,
          event_type: "status_changed",
          label: "Application needs your answer",
          metadata: {
            questionCount: incoming.length,
            action: input.action ?? null,
            attention,
          },
          idempotency_key: `${idempotencyKey}:needs-user:${input.providerReceipt?.providerSubmissionId ?? "profile"}`,
        },
        { onConflict: "user_id,idempotency_key" },
      ),
    ]);
  if (packetError || queueError || eventError)
    throw new Error(
      packetError?.message || queueError?.message || eventError?.message,
    );
  await sendApplicationNotification({
    kind: "needs_attention",
    to: input.recipient,
    userId: input.userId,
    inboxAlias: input.inboxAlias,
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
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!token)
    return Response.json(
      {
        error: "Your secure session is missing. Sign in again, then retry.",
        code: "SESSION_EXPIRED",
      },
      { status: 401, headers: NO_STORE },
    );

  try {
    const body = await readJsonBody<{
      applicationId?: string;
      approval?: string;
      packet?: ApplicationRecord;
    }>(request, 750_000);
    if (
      !/^[0-9a-f-]{36}$/i.test(body.applicationId ?? "") ||
      body.approval !== "SUBMIT_APPROVED_APPLICATION"
    ) {
      return Response.json(
        { error: "Explicit submission approval is required." },
        { status: 400, headers: NO_STORE },
      );
    }

    const admin = getSupabaseAdmin();
    const { data: authData, error: authError } =
      await admin.auth.getUser(token);
    if (authError || !authData.user) {
      console.warn("application_submit_auth_failed", {
        reason: authError?.message || "user_missing",
      });
      return Response.json(
        {
          error:
            "Your secure session expired before the application started. Sign in again, then retry.",
          code: "SESSION_EXPIRED",
        },
        { status: 401, headers: NO_STORE },
      );
    }
    const userId = authData.user.id;
    console.info("application_submit_stage", {
      applicationId: body.applicationId,
      stage: "authenticated",
    });
    if (body.packet) {
      try {
        await saveApprovedPacket({
          admin,
          userId,
          applicationId: body.applicationId as string,
          packet: body.packet,
        });
      } catch (error) {
        if (error instanceof InvalidApplicationPacketError) {
          return Response.json(
            { error: error.message },
            { status: 409, headers: NO_STORE },
          );
        }
        throw error;
      }
    }
    const [
      { data: packet, error: packetError },
      { data: profileRow, error: profileError },
    ] = await Promise.all([
      admin
        .from("application_packets")
        .select("*")
        .eq("id", body.applicationId)
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("application_profile")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    if (packetError || profileError)
      throw new Error(packetError?.message || profileError?.message);
    if (!packet)
      return Response.json(
        { error: "Application packet was not found." },
        { status: 404, headers: NO_STORE },
      );
    if (!approved(packet as DbRow))
      return Response.json(
        { error: "Review and approve every required field before submission." },
        { status: 409, headers: NO_STORE },
      );

    const job = packet.job_snapshot as JobDetail;
    const candidate = (profileRow?.application_profile ??
      {}) as ContractorProfile;
    const resumeText = normaliseResumeText(
      String(packet.tailored_cv_text || packet.source_cv_text || ""),
    );
    const readiness = evaluateProfileReadiness(candidate, resumeText);
    if (!readiness.complete) {
      const message = `Complete your application profile first: ${readiness.missing.map((item) => item.label).join(", ")}.`;
      const attention = buildApplicationAttention({
        action: "/profile",
        message,
      });
      return Response.json(
        {
          error: message,
          action: "/profile",
          attention,
          missingProfileItems: readiness.missing,
        },
        { status: 422, headers: NO_STORE },
      );
    }
    const candidateName = resolveCandidateName(
      candidate.fullName || "",
      resumeText,
    );
    if (!candidateName)
      return Response.json(
        {
          error:
            "Add your full name to your Application Profile or CV before submitting.",
          action: "/profile",
        },
        { status: 422, headers: NO_STORE },
      );

    const accountEmail =
      authData.user.email || candidate.email || candidate.forwardingEmail || "";
    const inbox = await ensureInboxAlias(admin, userId, accountEmail, true);
    const notificationEmail = inbox?.forwardingEmail || accountEmail;
    const submissionCandidate: ContractorProfile = {
      ...candidate,
      fullName: candidateName,
      email: inbox?.alias || candidate.email || accountEmail,
    };
    const coverLetter = normaliseCoverLetterSignoff(
      String(packet.cover_letter || ""),
      candidateName,
    );

    const employerDestination = await resolveEmployerDestinationForJob(
      job,
      admin,
    );
    const provider = employerDestination ? null : submissionProviderConfig();
    if (!employerDestination && !provider)
      return Response.json(
        { error: "One-click apply is not available for this role yet." },
        { status: 503, headers: NO_STORE },
      );
    let destination: string;
    if (employerDestination) destination = `email:${employerDestination.email}`;
    else {
      try {
        const parsed = new URL(job.apply_url);
        if (parsed.protocol !== "https:") throw new Error("invalid");
        destination = parsed.toString();
      } catch {
        return Response.json(
          {
            error: "This contract has no valid secure application destination.",
          },
          { status: 409, headers: NO_STORE },
        );
      }
    }

    const idempotencyKey = `submit:${packet.id}`;
    const { data: previous } = await admin
      .from("application_submissions")
      .select("status, receipt, error_code, provider_submission_id, updated_at")
      .eq("user_id", userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (previous?.status === "succeeded" && previous.receipt)
      return Response.json(
        { receipt: previous.receipt, duplicate: true },
        { status: 200, headers: NO_STORE },
      );
    const canResume =
      previous?.status === "processing" &&
      previous.error_code === "needs_user" &&
      Boolean(previous.provider_submission_id);
    const staleProcessing =
      previous?.status === "processing" &&
      isStaleSubmissionLock(previous.updated_at);
    if (
      previous?.status === "processing" &&
      !canResume &&
      previous.error_code !== "needs_user" &&
      !staleProcessing
    ) {
      return Response.json(
        {
          state: "processing",
          message: "This application is already being completed.",
          retryAfterSeconds: submissionRetryAfterSeconds(previous.updated_at),
        },
        { status: 202, headers: NO_STORE },
      );
    }

    const payloadHash = createHash("sha256")
      .update(
        JSON.stringify({
          applicationId: packet.id,
          updatedAt: packet.updated_at,
          destination,
        }),
      )
      .digest("hex");
    const { error: queueError } = await admin
      .from("application_submissions")
      .upsert(
        {
          user_id: userId,
          application_id: packet.id,
          provider_name: employerDestination
            ? "Verified employer email"
            : provider?.name,
          provider_submission_id: canResume
            ? previous?.provider_submission_id
            : null,
          idempotency_key: idempotencyKey,
          payload_hash: payloadHash,
          status: "processing",
          error_code: null,
          receipt: {
            state: "processing",
            message:
              "The approved application is queued for the employer portal.",
          },
          submitted_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,idempotency_key" },
      );
    if (queueError) throw new Error(queueError.message);
    console.info("application_submit_stage", {
      applicationId: String(packet.id),
      stage: "runner_queued",
      provider: employerDestination
        ? "verified_employer_email"
        : provider?.kind || "unavailable",
    });

    after(async () => {
      try {
        let resumeUrl: string | undefined;
        let resumeBuffer: Buffer | undefined;
        if (
          employerDestination ||
          provider?.kind === "tsenta" ||
          provider?.kind === "native"
        ) {
          resumeBuffer = await buildResumePdf({
            format: "pdf",
            resumeText,
            candidateName,
            jobTitle: job.title,
            companyName: job.company_name,
            versionLabel: String(
              packet.resume_version_label || "Application CV",
            ),
          });
          if (
            (provider?.kind === "tsenta" || provider?.kind === "native") &&
            !canResume
          ) {
            const storagePath = `${userId}/applications/${packet.id}.pdf`;
            const { error: uploadError } = await admin.storage
              .from("cvs")
              .upload(storagePath, resumeBuffer, {
                contentType: "application/pdf",
                upsert: true,
              });
            if (uploadError)
              throw new Error(
                "Your approved CV could not be prepared for the employer form.",
              );
            const { data: signedResume, error: signedError } =
              await admin.storage
                .from("cvs")
                .createSignedUrl(storagePath, 60 * 60);
            if (signedError || !signedResume?.signedUrl)
              throw new Error(
                "Your approved CV could not be prepared for the employer form.",
              );
            resumeUrl = signedResume.signedUrl;
          }
        }

        const screeningAnswers =
          (packet.screening_answers as ApplicationQuestion[]) ?? [];
        let providerReceipt = canResume
          ? await resumeSubmissionWithProvider(
              String(previous?.provider_submission_id),
              screeningAnswers,
            )
          : employerDestination
            ? await submitToVerifiedEmployerEmail({
                applicationId: String(packet.id),
                employerEmail: employerDestination.email,
                job,
                candidate: submissionCandidate,
                candidateName,
                resumePdf: resumeBuffer as Buffer,
                coverLetter,
                screeningAnswers: screeningAnswers.map(({ label, answer }) => ({
                  label,
                  answer,
                })),
                idempotencyKey,
              })
            : await submitWithProvider(
                {
                  applicationId: String(packet.id),
                  destination,
                  job,
                  candidate: submissionCandidate,
                  resume: {
                    label: String(
                      packet.resume_version_label || "Application CV",
                    ),
                    text: resumeText,
                    url: resumeUrl,
                  },
                  coverLetter,
                  screeningAnswers: screeningAnswers.map(
                    ({ label, answer, source }) => ({ label, answer, source }),
                  ),
                },
                idempotencyKey,
                provider?.kind === "native"
                  ? {
                      portalPassword: submissionCandidate.portalAccountConsent
                        ? portalPassword(userId, destination)
                        : undefined,
                      resolvePortalPassword: submissionCandidate.portalAccountConsent
                        ? async (hostname) =>
                            portalPassword(userId, `https://${hostname}/`)
                        : undefined,
                      resolveEmailVerificationCode:
                        submissionCandidate.automaticEmailVerification
                          ? ({ requestedAfter }) =>
                              waitForEmailVerificationCode({
                                admin,
                                userId,
                                applicationId: String(packet.id),
                                alias: inbox?.alias,
                                requestedAfter,
                              })
                          : undefined,
                      loadPortalSession: submissionCandidate.portalAccountConsent
                        ? () =>
                            loadPortalSession({
                              admin,
                              userId,
                              applicationId: String(packet.id),
                            })
                        : undefined,
                      savePortalSession: submissionCandidate.portalAccountConsent
                        ? (session) =>
                            savePortalSession({
                              admin,
                              userId,
                              applicationId: String(packet.id),
                              destinationHost: new URL(destination).hostname,
                              session,
                            })
                        : undefined,
                      clearPortalSession: submissionCandidate.portalAccountConsent
                        ? () =>
                            clearPortalSession({
                              admin,
                              userId,
                              applicationId: String(packet.id),
                            })
                        : undefined,
                    }
                  : undefined,
              );

        // Only the remote managed provider exposes a resumable review endpoint.
        // The owned browser runner already consumes all confirmed profile facts
        // during its pass and returns any genuinely unresolved fields to the user.
        for (
          let attempt = 0;
          provider?.kind === "tsenta" &&
          attempt < 4 &&
          providerReceipt.state === "needs_user";
          attempt += 1
        ) {
          const knownAnswers = knownProviderAnswers(
            providerReviewQuestions(providerReceipt.review),
            submissionCandidate,
            packet as DbRow,
          );
          if (
            knownAnswers.length === 0 ||
            knownAnswers.some(
              (question) => question.required && !question.reviewed,
            )
          )
            break;
          providerReceipt = await resumeSubmissionWithProvider(
            providerReceipt.providerSubmissionId,
            knownAnswers,
          );
        }

        console.info("application_submit_stage", {
          applicationId: String(packet.id),
          stage: "runner_finished",
          result: providerReceipt.state,
        });

        if (providerReceipt.state === "needs_user") {
          const action = providerReviewAction(providerReceipt);
          const reviewQuestions = providerReviewQuestions(
            providerReceipt.review,
          );
          const runnerIssue =
            reviewQuestions.length === 0 &&
            [
              "unsupported_form",
              "validation_failed",
              "form_too_long",
              "unsupported_portal",
              "runner_timeout",
              "source_access_denied",
            ].includes(action ?? "");
          if (runnerIssue) {
            const stoppedAt = new Date().toISOString();
            const sourceUnavailable = action === "source_access_denied";
            const attention = buildApplicationAttention({
              action: sourceUnavailable ? action : "retry",
              message: providerReceipt.message,
            });
            const [
              { error: submissionError },
              { error: packetError },
              { error: eventError },
            ] = await Promise.all([
              admin
                .from("application_submissions")
                .update({
                  status: "failed",
                  provider_submission_id:
                    providerReceipt.providerSubmissionId || null,
                  error_code: action,
                  receipt: {
                    state: "failed",
                    message: providerReceipt.message,
                    action: sourceUnavailable ? action : "retry",
                    attention,
                  },
                  updated_at: stoppedAt,
                })
                .eq("user_id", userId)
                .eq("idempotency_key", idempotencyKey),
              admin
                .from("application_packets")
                .update({
                  status: sourceUnavailable ? "failed" : "ready",
                  updated_at: stoppedAt,
                })
                .eq("id", packet.id)
                .eq("user_id", userId),
              admin.from("application_events").upsert(
                {
                  user_id: userId,
                  application_id: packet.id,
                  event_type: "status_changed",
                  label:
                    sourceUnavailable
                      ? "Employer application page is unavailable"
                      : "Application stopped before confirmation and is ready to retry",
                  metadata: { reason: action, attention },
                  idempotency_key: `${idempotencyKey}:runner-issue:${payloadHash}`,
                },
                { onConflict: "user_id,idempotency_key" },
              ),
            ]);
            if (submissionError || packetError || eventError)
              throw new Error(
                submissionError?.message ||
                  packetError?.message ||
                  eventError?.message,
              );
            if (!sourceUnavailable)
              await sendApplicationNotification({
                kind: "submission_issue",
                to: notificationEmail,
                userId,
                inboxAlias: inbox?.alias,
                candidateName,
                jobTitle: job.title,
                companyName: job.company_name,
                applicationId: String(packet.id),
                idempotencyKey: `${idempotencyKey}:submission-issue:${payloadHash}`,
              }).catch(() => null);
            return;
          }
          await storeNeedsUser({
            admin,
            userId,
            packet: packet as DbRow,
            job,
            recipient: notificationEmail,
            inboxAlias: inbox?.alias,
            candidateName,
            providerReceipt,
            message: providerReceipt.message,
            action,
          });
          return;
        }
        if (providerReceipt.state === "processing") {
          await admin
            .from("application_submissions")
            .update({
              status: "processing",
              provider_submission_id: providerReceipt.providerSubmissionId,
              error_code: null,
              receipt: {
                state: "processing",
                message: providerReceipt.message,
              },
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("idempotency_key", idempotencyKey);
          return;
        }

        const receipt: ApplicationReceipt = {
          receiptId: providerReceipt.providerSubmissionId,
          mode: "external_handoff",
          createdAt: providerReceipt.submittedAt,
          destination: providerReceipt.destination || destination,
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
          { error: submissionError },
          { error: updateError },
          { error: eventError },
        ] = await Promise.all([
          admin
            .from("application_submissions")
            .update({
              status: "succeeded",
              provider_submission_id: providerReceipt.providerSubmissionId,
              receipt,
              error_code: null,
              submitted_at: providerReceipt.submittedAt,
              updated_at: now,
            })
            .eq("user_id", userId)
            .eq("idempotency_key", idempotencyKey),
          admin
            .from("application_packets")
            .update({
              status: "applied",
              mode: "external_handoff",
              receipt,
              updated_at: now,
            })
            .eq("id", packet.id)
            .eq("user_id", userId),
          admin
            .from("application_events")
            .upsert(
              {
                user_id: userId,
                application_id: packet.id,
                event_type: "status_changed",
                label: "Application submitted successfully",
                metadata: {
                  providerSubmissionId: providerReceipt.providerSubmissionId,
                },
                idempotency_key: `${idempotencyKey}:event`,
              },
              { onConflict: "user_id,idempotency_key" },
            ),
        ]);
        if (submissionError || updateError || eventError)
          throw new Error(
            submissionError?.message ||
              updateError?.message ||
              eventError?.message,
          );
        await sendApplicationNotification({
          kind: "submitted",
          to: notificationEmail,
          userId,
          inboxAlias: inbox?.alias,
          candidateName,
          jobTitle: job.title,
          companyName: job.company_name,
          applicationId: String(packet.id),
          idempotencyKey: `${idempotencyKey}:submitted`,
        }).catch(() => null);
        return;
      } catch (providerError) {
        const providerMessage =
          providerError instanceof Error ? providerError.message : "";
        if (providerMessage.startsWith("Complete your Application Profile")) {
          await storeNeedsUser({
            admin,
            userId,
            packet: packet as DbRow,
            job,
            recipient: notificationEmail,
            inboxAlias: inbox?.alias,
            candidateName,
            message: providerMessage,
            action: "/profile",
          });
          return;
        }
        const failure = applicationSubmissionFailure(providerError);
        const attention = buildApplicationAttention({
          action: "retry",
          message: failure.message,
        });
        console.error("application_runner_failed", {
          applicationId: String(packet.id),
          provider: employerDestination
            ? "verified_employer_email"
            : provider?.kind || "unavailable",
          reason:
            providerMessage
              .replace(/[\u0000-\u001f\u007f]/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 300) || "unknown",
        });
        const failedAt = new Date().toISOString();
        await Promise.all([
          admin
            .from("application_submissions")
            .update({
              status: "failed",
              error_code: failure.code,
              receipt: {
                state: "failed",
                message: failure.message,
                action: "retry",
                attention,
              },
              updated_at: failedAt,
            })
            .eq("user_id", userId)
            .eq("idempotency_key", idempotencyKey),
          admin
            .from("application_packets")
            .update({
              status: "ready",
              updated_at: failedAt,
            })
            .eq("id", packet.id)
            .eq("user_id", userId),
          admin
            .from("application_events")
            .upsert(
              {
                user_id: userId,
                application_id: packet.id,
                event_type: "status_changed",
                label: "Application stopped before confirmation and is ready to retry",
                metadata: { reason: failure.code, attention },
                idempotency_key: `${idempotencyKey}:failed:${payloadHash}`,
              },
              { onConflict: "user_id,idempotency_key" },
            ),
        ]);
        await sendApplicationNotification({
          kind: "submission_issue",
          to: notificationEmail,
          userId,
          inboxAlias: inbox?.alias,
          candidateName,
          jobTitle: job.title,
          companyName: job.company_name,
          applicationId: String(packet.id),
          idempotencyKey: `${idempotencyKey}:submission-issue`,
        }).catch(() => null);
        return;
      }
    });
    return Response.json(
      {
        state: "processing",
        message:
          "Your approved application is being completed securely in the background.",
        retryAfterSeconds: 10,
      },
      { status: 202, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof RequestBodyError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: NO_STORE },
      );
    return Response.json(
      { error: safeSubmissionError(error) },
      { status: 502, headers: NO_STORE },
    );
  }
}
