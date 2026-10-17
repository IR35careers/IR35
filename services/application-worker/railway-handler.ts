import { z } from "zod";
import { applicationKickSchema } from "../../src/lib/queue/config";
import type { ApplicationWorkerAssignment, ApplicationWorkerCallback, ApplicationWorkerClaimRequest } from "../../src/lib/application-worker-types";

export class LeaseDeferred extends Error {
  constructor(public readonly seconds: number) { super("Application lease is not due."); }
}

const taskSchema = z.object({
  id: z.uuid(), user_id: z.uuid(), application_id: z.uuid(), idempotency_key: z.string().min(1),
  destination: z.url(), callback_url: z.url(), status: z.literal("running"), attempts: z.number().int().positive(),
});
const assignmentBoundary = z.object({ task: taskSchema }).passthrough();

export async function handleRailwayApplication(input: {
  data: unknown;
  workerId: string;
  startedAt: string;
  version: string;
  signal: AbortSignal;
  claim: (request: ApplicationWorkerClaimRequest) => Promise<ApplicationWorkerAssignment | null>;
  pending: (id: string) => Promise<{ status: string; available_at: string | null; lease_expires_at: string | null } | null>;
  execute: (assignment: ApplicationWorkerAssignment, signal: AbortSignal) => Promise<ApplicationWorkerCallback>;
  callback: (assignment: ApplicationWorkerAssignment, result: ApplicationWorkerCallback) => Promise<{ ok: boolean }>;
}) {
  const kick = applicationKickSchema.parse(input.data);
  input.signal.throwIfAborted();
  if (!kick.applicationId) return { state: "idle" };
  const previous = await input.pending(kick.applicationId);
  if (!previous || !["queued", "running"].includes(previous.status)) return { state: "idle" };
  if (previous.status === "running") {
    // A dead browser might have clicked Submit. Never replay an expired lease
    // automatically; the watchdog records runner_timeout for explicit review.
    throw new LeaseDeferred(30);
  }
  const assignment = await input.claim({
    workerId: input.workerId, startedAt: input.startedAt, acceptTask: true,
    preferredApplicationId: kick.applicationId || undefined,
    active: 0, concurrency: 1, completed: 0, failed: 0, version: input.version,
  });
  if (!assignment) {
    if (kick.applicationId) {
      const pending = await input.pending(kick.applicationId);
      if (pending && ["queued", "running"].includes(pending.status)) {
        const due = Date.parse(pending.status === "running" ? pending.lease_expires_at || "" : pending.available_at || "");
        throw new LeaseDeferred(Number.isFinite(due) ? Math.max(15, Math.min(600, Math.ceil((due - Date.now()) / 1000) + 2)) : 60);
      }
    }
    return { state: "idle" };
  }
  if (!assignmentBoundary.safeParse(assignment).success ||
    (kick.applicationId && assignment.task.application_id !== kick.applicationId))
    throw new Error("Worker assignment does not match the queued application.");
  // A callback acknowledgement failure retries delivery of the same result,
  // never the employer form: task/attempt guards make it idempotent.
  input.signal.throwIfAborted();
  const result = await input.execute(assignment, input.signal);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const saved = await input.callback(assignment, result);
      if (!saved.ok) throw new Error("Callback not acknowledged.");
      return { state: result.receipt?.state || "needs_user" };
    } catch {
      if (attempt === 2) throw new Error("The worker result could not be persisted; confirmation is unknown.");
    }
  }
  throw new Error("Callback delivery failed.");
}
