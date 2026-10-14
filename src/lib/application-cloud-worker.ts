import { randomUUID } from "node:crypto";
import { applicationWorkerAppOrigin } from "@/lib/application-worker-auth";
import { ApplicationLeasePending, type ApplicationCloudKick } from "@/lib/application-cloud-queue";
import { claimApplicationWorkerAssignment, executeApplicationWorkerAssignment, postApplicationWorkerCallback } from "@/lib/application-worker-executor";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function executeCloudApplication(kick: ApplicationCloudKick) {
  const appOrigin = applicationWorkerAppOrigin(process.env.IR35CAREERS_APP_URL);
  const assignment = await claimApplicationWorkerAssignment({
    appOrigin,
    claim: {
      workerId: `vercel-queue-${randomUUID().slice(0, 12)}`,
      startedAt: new Date().toISOString(),
      acceptTask: true,
      preferredApplicationId: kick.applicationId || undefined,
      active: 0, concurrency: 1, completed: 0, failed: 0,
      version: `cloud-${String(process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "production").slice(0, 60)}`,
    },
  });
  if (!assignment) {
    if (kick.applicationId) {
      const { data, error } = await getSupabaseAdmin().from("application_worker_tasks")
        .select("status, available_at, lease_expires_at")
        .eq("application_id", kick.applicationId).maybeSingle();
      if (error) throw new Error("Unable to verify the pending application lease.");
      // Never acknowledge a retry while a crashed invocation's lease is still
      // live, or while a delayed verification attempt is not due yet.
      if (data && ["queued", "running"].includes(data.status)) {
        const due = Date.parse(data.status === "running" ? data.lease_expires_at : data.available_at);
        throw new ApplicationLeasePending(Number.isFinite(due) ? Math.ceil((due - Date.now()) / 1_000) + 2 : 60);
      }
    }
    return { state: "idle" as const };
  }
  const callback = await executeApplicationWorkerAssignment({ assignment, appOrigin, budgetMs: 210_000 });
  const saved = await postApplicationWorkerCallback({ task: assignment.task, callback, appOrigin });
  if (!saved.ok) throw new Error("The cloud application result was not accepted.");
  console.info("cloud_application_processed", { applicationId: assignment.task.application_id, state: saved.state, duplicate: saved.duplicate === true });
  return { state: saved.state || "needs_user", applicationId: assignment.task.application_id };
}
