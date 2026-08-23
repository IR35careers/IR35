import { buildApplicationAttention } from "@/lib/application-attention";
import type { ApplicationAttention } from "@/lib/workspace/types";

type SubmissionRow = Record<string, unknown> | null | undefined;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function storedAttention(value: unknown): ApplicationAttention | null {
  const attention = record(value);
  if (
    !attention ||
    typeof attention.kind !== "string" ||
    typeof attention.title !== "string" ||
    typeof attention.message !== "string" ||
    typeof attention.action !== "string" ||
    typeof attention.actionLabel !== "string" ||
    !Array.isArray(attention.questionIds)
  )
    return null;
  return attention as unknown as ApplicationAttention;
}

/**
 * The submission queue owns the latest employer-form result. Application
 * events are intentionally append-only, so a generic retry event can be newer
 * than the precise worker result. Prefer the queue receipt when rebuilding the
 * contractor workspace so the customer sees the real next action.
 */
export function submissionAttentionFromRow(
  submission: SubmissionRow,
): ApplicationAttention | null {
  if (!submission) return null;
  const receipt = record(submission.receipt);
  if (!receipt) return null;

  const exact = storedAttention(receipt.attention);
  if (exact) return exact;

  const status = String(submission.status ?? "");
  const errorCode = String(submission.error_code ?? "");
  const action = typeof receipt.action === "string" ? receipt.action.trim() : "";
  const message =
    typeof receipt.message === "string" ? receipt.message.trim() : "";
  if (
    status !== "processing" ||
    errorCode !== "needs_user" ||
    (!action && !message)
  )
    return null;

  return buildApplicationAttention({ action, message });
}
