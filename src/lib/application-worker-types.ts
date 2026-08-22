import type {
  NativePortalSession,
  SubmissionProviderPayload,
  SubmissionProviderReceipt,
} from "@/lib/application-submission";

export interface ApplicationWorkerTaskRow {
  id: string;
  user_id: string;
  application_id: string;
  idempotency_key: string;
  destination: string;
  callback_url: string;
  status: "queued" | "running" | "completed" | "needs_user" | "failed" | "cancelled";
  attempts: number;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
}

export interface ApplicationWorkerCallback {
  taskId: string;
  userId: string;
  applicationId: string;
  idempotencyKey: string;
  completedAt: string;
  receipt?: SubmissionProviderReceipt;
  error?: string;
  portalSession?: NativePortalSession;
  clearPortalSession?: boolean;
}

export interface ApplicationWorkerAssignment {
  task: ApplicationWorkerTaskRow;
  payload?: SubmissionProviderPayload;
  portalPassword?: string;
  portalSession?: NativePortalSession | null;
  preflightError?: string;
}

export interface ApplicationWorkerClaimRequest {
  workerId: string;
  startedAt: string;
  acceptTask: boolean;
  active: number;
  concurrency: number;
  completed: number;
  failed: number;
  version: string;
}

export function validApplicationWorkerCallback(
  value: unknown,
): value is ApplicationWorkerCallback {
  if (!value || typeof value !== "object") return false;
  const callback = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    typeof callback.taskId !== "string" ||
    !uuid.test(callback.taskId) ||
    typeof callback.userId !== "string" ||
    !uuid.test(callback.userId) ||
    typeof callback.applicationId !== "string" ||
    !uuid.test(callback.applicationId) ||
    typeof callback.idempotencyKey !== "string" ||
    callback.idempotencyKey !== `submit:${callback.applicationId}` ||
    typeof callback.completedAt !== "string" ||
    !Number.isFinite(new Date(callback.completedAt).getTime())
  )
    return false;
  if (
    callback.clearPortalSession !== undefined &&
    typeof callback.clearPortalSession !== "boolean"
  )
    return false;
  if (callback.portalSession !== undefined) {
    if (!callback.portalSession || typeof callback.portalSession !== "object")
      return false;
    const session = callback.portalSession as Record<string, unknown>;
    if (!session.storageState || typeof session.storageState !== "object")
      return false;
    const state = session.storageState as Record<string, unknown>;
    if (!Array.isArray(state.cookies) || !Array.isArray(state.origins))
      return false;
  }
  if (callback.error !== undefined)
    return typeof callback.error === "string" && callback.error.length <= 1_000;
  if (!callback.receipt || typeof callback.receipt !== "object") return false;
  const receipt = callback.receipt as Record<string, unknown>;
  return (
    ["submitted", "processing", "needs_user"].includes(String(receipt.state)) &&
    typeof receipt.providerSubmissionId === "string" &&
    typeof receipt.submittedAt === "string" &&
    typeof receipt.message === "string" &&
    receipt.message.length <= 2_000
  );
}
