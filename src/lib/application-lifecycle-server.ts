import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applicationDeliveryStatusSchema } from "@/lib/application-lifecycle";

const resultSchema = z.object({
  applicationId: z.uuid(), userId: z.uuid(),
  status: z.enum(["submitted", "needs_info", "failed", "external_only", "skipped"]),
  receipt: z.record(z.string(), z.unknown()),
  questions: z.array(z.object({ id: z.string(), label: z.string(), answer: z.string(), required: z.boolean(), reviewed: z.boolean(), source: z.enum(["profile", "user", "job"]) })).optional(),
  keepApproval: z.boolean().default(true), reason: z.string().max(100).nullable().default(null),
  detail: z.string().max(2000).nullable().default(null), taskId: z.uuid().optional(), attempt: z.number().int().nonnegative().optional(),
});
export async function commitDeliveryResult(admin: SupabaseClient, input: z.input<typeof resultSchema>) {
  const value = resultSchema.parse(input);
  const result = await admin.rpc("commit_application_delivery_result", {
    p_id: value.applicationId, p_user_id: value.userId, p_to: value.status, p_receipt: value.receipt,
    p_questions: value.questions ?? null, p_keep_approval: value.keepApproval,
    p_reason: value.reason, p_detail: value.detail, p_task_id: value.taskId ?? null, p_attempt: value.attempt ?? null,
  });
  if (result.error) throw new Error("The worker outcome could not be committed. The saved status has not been reset.");
  return result.data;
}

export async function transitionDelivery(admin: SupabaseClient, input: {
  applicationId: string; userId: string; status: z.infer<typeof applicationDeliveryStatusSchema>;
  reason?: string; detail?: string; explicitRetry?: boolean;
}) {
  const value = z.object({ applicationId: z.uuid(), userId: z.uuid(), status: applicationDeliveryStatusSchema,
    reason: z.string().max(100).optional(), detail: z.string().max(2000).optional(), explicitRetry: z.boolean().optional() }).parse(input);
  const result = await admin.rpc("transition_application_delivery", {
    p_id: value.applicationId, p_user_id: value.userId, p_to: value.status,
    p_reason: value.reason ?? null, p_detail: value.detail ?? null, p_retry: value.explicitRetry ?? false,
  });
  if (result.error) throw new Error("The application status changed. Reload its saved status before retrying.");
  return result.data;
}
