import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { kickApplicationWorker } from "@/lib/application-worker-kick";
import { recoverPendingVerificationEmails } from "@/lib/email/recover-pending-verifications";

/** Repair a database/queue publish gap without relying on a client polling. */
export async function reconcileCloudApplications(): Promise<number> {
  const admin = getSupabaseAdmin();
  await recoverPendingVerificationEmails({ admin });
  const { data, error } = await admin.from("application_worker_tasks")
    .select("application_id, status, available_at, lease_expires_at")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true }).limit(100);
  if (error) throw new Error("Unable to reconcile durable application tasks.");
  let published = 0;
  for (const task of data ?? []) {
    const due = Date.parse(task.status === "running" ? task.lease_expires_at : task.available_at);
    await kickApplicationWorker({ applicationId: task.application_id, reason: "scheduled_queue_reconciliation", delaySeconds: Math.max(0, Math.ceil((due - Date.now()) / 1_000)) || 0 });
    published += 1;
  }
  return published;
}
