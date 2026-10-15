import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { providerReviewQuestions, type SubmissionProviderReceipt } from "@/lib/application-submission";
import { buildApplicationAttention } from "@/lib/application-attention";
import { sendApplicationNotification } from "@/lib/email/application-notifications";
import { commitDeliveryResult } from "@/lib/application-lifecycle-server";
import { isUnresolvedAggregator } from "@/lib/application-lifecycle";
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
  taskId?: string;
  attempt?: number;
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
  const externalOnly = input.action !== "/profile" && incoming.length === 0 &&
    isUnresolvedAggregator(input.providerReceipt?.destination || input.job.apply_url);
  await commitDeliveryResult(input.admin, {
    applicationId: String(input.packet.id), userId: input.userId,
    status: externalOnly ? "external_only" : "needs_info", questions,
    keepApproval: !applicationMaterialsNeedApproval, taskId: input.taskId, attempt: input.attempt,
    reason: externalOnly ? "unsupported_aggregator" : (input.action || "employer_action_required").slice(0, 100),
    detail: input.message.slice(0, 2000),
    receipt: { state: "needs_user", review: input.providerReceipt?.review ?? null,
      message: input.message, action: externalOnly ? "external_only" : input.action ?? null,
      destination: input.providerReceipt?.destination ?? input.job.apply_url, attention },
  });
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
    questionLabels: incoming
      .filter((question) => question.required && !question.answer.trim())
      .map((question) => question.label),
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
  taskId?: string;
  attempt?: number;
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
  await commitDeliveryResult(input.admin, {
    applicationId: String(input.packet.id), userId: input.userId, status: "submitted",
    receipt: { ...receipt }, taskId: input.taskId, attempt: input.attempt,
  });
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
