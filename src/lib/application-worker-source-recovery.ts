import type { SupabaseClient } from "@supabase/supabase-js";
import { isDiscoveryOnlyHost } from "@/lib/application-runner/source-resolution";
import { resolveApplicationTaskDestination } from "@/lib/application-worker-destination";

type SubmissionRow = {
  id: string;
  user_id: string;
  application_id: string;
  idempotency_key: string;
  receipt: Record<string, unknown> | null;
};

type WorkerTaskRow = {
  id: string;
  user_id: string;
  application_id: string;
  idempotency_key: string;
  destination: string;
  status: string;
};

function recoveryVersion(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 60) || "unknown";
}

export function shouldRecoverDiscoverySource(input: {
  action?: string;
  taskStatus?: string;
  destination?: string;
}): boolean {
  if (input.action !== "employer_login" || input.taskStatus !== "needs_user")
    return false;
  try {
    const destination = new URL(input.destination ?? "");
    return (
      destination.protocol === "https:" &&
      isDiscoveryOnlyHost(destination.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Older attempts can be paused on a job-board account wall even when the
 * recruiter's own site exposes a public application form. A new worker
 * release gets one automatic attempt to resolve those roles to the verified
 * direct source. The release-specific event prevents a restart loop.
 */
export async function recoverDiscoverySourceApplications(input: {
  admin: SupabaseClient;
  workerVersion: string;
  limit?: number;
}): Promise<{ checked: number; recovered: string[] }> {
  const limit = Math.max(1, Math.min(input.limit ?? 10, 25));
  const submissionsResult = await input.admin
    .from("application_submissions")
    .select("id, user_id, application_id, idempotency_key, receipt")
    .eq("error_code", "needs_user")
    .order("updated_at", { ascending: true })
    .limit(limit * 3);
  if (submissionsResult.error) throw submissionsResult.error;

  const submissions = (submissionsResult.data ?? []) as SubmissionRow[];
  const candidates = submissions.filter(
    (submission) => String(submission.receipt?.action ?? "") === "employer_login",
  );
  if (!candidates.length) return { checked: 0, recovered: [] };

  const applicationIds = [...new Set(candidates.map((row) => row.application_id))];
  const tasksResult = await input.admin
    .from("application_worker_tasks")
    .select("id, user_id, application_id, idempotency_key, destination, status")
    .in("application_id", applicationIds)
    .eq("status", "needs_user");
  if (tasksResult.error) throw tasksResult.error;
  const tasks = (tasksResult.data ?? []) as WorkerTaskRow[];
  const tasksByKey = new Map(
    tasks.map((task) => [`${task.user_id}:${task.application_id}`, task]),
  );

  const recovered: string[] = [];
  let checked = 0;
  const version = recoveryVersion(input.workerVersion);
  for (const submission of candidates.slice(0, limit)) {
    const task = tasksByKey.get(
      `${submission.user_id}:${submission.application_id}`,
    );
    const destination = resolveApplicationTaskDestination({
      taskDestination: task?.destination,
      receiptDestination: submission.receipt?.destination,
    });
    if (
      !task ||
      !shouldRecoverDiscoverySource({
        action: String(submission.receipt?.action ?? ""),
        taskStatus: task.status,
        destination: destination ?? "",
      })
    )
      continue;
    checked += 1;

    const eventKey = `submit:${submission.application_id}:direct-source:${version}`;
    const eventResult = await input.admin
      .from("application_events")
      .select("id")
      .eq("user_id", submission.user_id)
      .eq("idempotency_key", eventKey)
      .maybeSingle();
    if (eventResult.error) throw eventResult.error;
    if (eventResult.data) continue;

    const packetResult = await input.admin
      .from("application_packets")
      .select(
        "screening_answers, truth_approved, materials_approved, submission_approved",
      )
      .eq("id", submission.application_id)
      .eq("user_id", submission.user_id)
      .maybeSingle();
    if (packetResult.error) throw packetResult.error;
    const packet = packetResult.data as {
      screening_answers?: Array<Record<string, unknown>>;
      truth_approved?: boolean;
      materials_approved?: boolean;
      submission_approved?: boolean;
    } | null;
    const questionsReady = (packet?.screening_answers ?? []).every(
      (question) =>
        !question.required ||
        (question.reviewed === true && String(question.answer ?? "").trim()),
    );
    if (
      !packet?.truth_approved ||
      !packet.materials_approved ||
      !packet.submission_approved ||
      !questionsReady
    )
      continue;

    const now = new Date().toISOString();
    const results = await Promise.all([
      input.admin
        .from("application_worker_tasks")
        .update({
          destination,
          status: "queued",
          attempts: 0,
          available_at: now,
          lease_owner: null,
          lease_expires_at: null,
          last_error: null,
          completed_at: null,
          updated_at: now,
        })
        .eq("id", task.id)
        .eq("status", "needs_user"),
      input.admin
        .from("application_submissions")
        .update({
          status: "processing",
          error_code: null,
          receipt: {
            state: "processing",
            message:
              "IR35Careers is locating the recruiter's direct application form and continuing automatically.",
            destination,
          },
          updated_at: now,
        })
        .eq("id", submission.id)
        .eq("error_code", "needs_user"),
      input.admin
        .from("application_packets")
        .update({ status: "ready", updated_at: now })
        .eq("id", submission.application_id)
        .eq("user_id", submission.user_id),
      input.admin.from("application_events").upsert(
        {
          user_id: submission.user_id,
          application_id: submission.application_id,
          event_type: "status_changed",
          label: "Direct employer application route retry started",
          metadata: {
            source: "worker_recovery",
            workerVersion: version,
            previousDestination: destination,
          },
          idempotency_key: eventKey,
        },
        { onConflict: "user_id,idempotency_key", ignoreDuplicates: true },
      ),
    ]);
    const failure = results.find((result) => result.error)?.error;
    if (failure) throw failure;
    recovered.push(submission.application_id);
  }

  return { checked, recovered };
}
