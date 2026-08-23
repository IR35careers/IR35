import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { providerReviewQuestions, type SubmissionProviderReceipt } from "@/lib/application-submission";
import { buildApplicationAttention } from "@/lib/application-attention";
import { sendApplicationNotification } from "@/lib/email/application-notifications";
import type { JobDetail } from "@/lib/job-types";
import type {
  ApplicationQuestion,
  ApplicationReceipt,
} from "@/lib/workspace/types";

type DbRow = Record<string, unknown>;

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

export function providerReviewAction(
  receipt: SubmissionProviderReceipt | undefined,
): string | undefined {
  if (!receipt?.review || typeof receipt.review !== "object") return undefined;
  const action = (receipt.review as Record<string, unknown>).action;
  return typeof action === "string" && action.trim()
    ? action.trim().slice(0, 80)
    : undefined;
}

export async function storeNeedsUser(input: {
  admin: SupabaseClient;
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
  const applicationMaterialsNeedApproval =
    input.action === "/profile" ||
    incoming.some((question) => question.required && !question.reviewed);
  const attention = buildApplicationAttention({
    action: input.action,
    message: input.message,
    questions: incoming.length ? incoming : questions,
  });
  const now = new Date().toISOString();
  const idempotencyKey = `submit:${String(input.packet.id)}`;
  const attentionKey = createHash("sha256")
    .update(
      JSON.stringify({
        action: input.action ?? "",
        message: input.message,
        questions: incoming.map((question) => question.label),
      }),
    )
    .digest("hex")
    .slice(0, 18);
  const [{ error: packetError }, { error: queueError }, { error: eventError }] =
    await Promise.all([
      input.admin
        .from("application_packets")
        .update({
          status: "needs_review",
          screening_answers: questions,
          submission_approved: applicationMaterialsNeedApproval
            ? false
            : Boolean(input.packet.submission_approved),
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
            destination: input.providerReceipt?.destination ?? null,
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
          label: attention.title,
          metadata: {
            questionCount: incoming.length,
            action: input.action ?? null,
            attention,
          },
          idempotency_key: `${idempotencyKey}:needs-user:${attentionKey}`,
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
    jobId: input.job.id,
    applicationId: String(input.packet.id),
    action: input.action,
    idempotencyKey: `${idempotencyKey}:needs-user:${attentionKey}`,
  }).catch(() => null);
  return questions;
}

export async function storeSubmittedApplication(input: {
  admin: SupabaseClient;
  userId: string;
  packet: DbRow;
  job: JobDetail;
  recipient: string;
  inboxAlias?: string;
  candidateName: string;
  providerReceipt: SubmissionProviderReceipt;
  destination: string;
}): Promise<ApplicationReceipt> {
  const idempotencyKey = `submit:${String(input.packet.id)}`;
  const receipt: ApplicationReceipt = {
    receiptId: input.providerReceipt.providerSubmissionId,
    mode: "external_handoff",
    createdAt: input.providerReceipt.submittedAt,
    destination: input.providerReceipt.destination || input.destination,
    reviewedFields: [
      "cv",
      "cover_letter",
      "screening_answers",
      "destination",
    ],
    skippedFields: [],
    message: input.providerReceipt.message,
  };
  const now = new Date().toISOString();
  const [
    { error: submissionError },
    { error: packetError },
    { error: eventError },
  ] = await Promise.all([
    input.admin
      .from("application_submissions")
      .update({
        status: "succeeded",
        provider_submission_id: input.providerReceipt.providerSubmissionId,
        receipt,
        error_code: null,
        submitted_at: input.providerReceipt.submittedAt,
        updated_at: now,
      })
      .eq("user_id", input.userId)
      .eq("idempotency_key", idempotencyKey),
    input.admin
      .from("application_packets")
      .update({
        status: "applied",
        mode: "external_handoff",
        receipt,
        updated_at: now,
      })
      .eq("id", input.packet.id)
      .eq("user_id", input.userId),
    input.admin.from("application_events").upsert(
      {
        user_id: input.userId,
        application_id: input.packet.id,
        event_type: "status_changed",
        label: "Application submitted successfully",
        metadata: {
          providerSubmissionId: input.providerReceipt.providerSubmissionId,
        },
        idempotency_key: `${idempotencyKey}:event`,
      },
      { onConflict: "user_id,idempotency_key" },
    ),
  ]);
  if (submissionError || packetError || eventError)
    throw new Error(
      submissionError?.message || packetError?.message || eventError?.message,
    );
  await sendApplicationNotification({
    kind: "submitted",
    to: input.recipient,
    userId: input.userId,
    inboxAlias: input.inboxAlias,
    candidateName: input.candidateName,
    jobTitle: input.job.title,
    companyName: input.job.company_name,
    jobId: input.job.id,
    applicationId: String(input.packet.id),
    idempotencyKey: `${idempotencyKey}:submitted`,
  }).catch(() => null);
  return receipt;
}
