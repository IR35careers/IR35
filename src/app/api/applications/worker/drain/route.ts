import { randomUUID } from "node:crypto";
import { applicationWorkerAppOrigin } from "@/lib/application-worker-auth";
import {
  ApplicationWorkerRequestError,
  readSignedApplicationWorkerJson,
} from "@/lib/application-worker-request";
import {
  claimApplicationWorkerAssignment,
  executeApplicationWorkerAssignment,
  postApplicationWorkerCallback,
  safeApplicationWorkerError,
} from "@/lib/application-worker-executor";

export const runtime = "nodejs";
export const maxDuration = 300;

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function validKick(value: unknown): value is {
  kickId: string;
  applicationId?: string | null;
  reason: string;
  requestedAt: string;
} {
  if (!value || typeof value !== "object") return false;
  const kick = value as Record<string, unknown>;
  return Boolean(
    typeof kick.kickId === "string" &&
      /^[0-9a-f-]{36}$/i.test(kick.kickId) &&
      (kick.applicationId === null ||
        kick.applicationId === undefined ||
        (typeof kick.applicationId === "string" &&
          /^[0-9a-f-]{36}$/i.test(kick.applicationId))) &&
      typeof kick.reason === "string" &&
      kick.reason.length <= 80 &&
      typeof kick.requestedAt === "string" &&
      Number.isFinite(new Date(kick.requestedAt).getTime()),
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = await readSignedApplicationWorkerJson(request, 10_000);
    if (!validKick(parsed))
      return Response.json(
        { error: "The cloud worker request is invalid." },
        { status: 400, headers: HEADERS },
      );
    const appOrigin = applicationWorkerAppOrigin(
      process.env.IR35CAREERS_APP_URL || "https://www.ir35careers.com",
    );
    const startedAt = new Date().toISOString();
    const workerId = `vercel-${String(process.env.VERCEL_REGION || "cloud")
      .replace(/[^a-z0-9-]/gi, "-")
      .slice(0, 30)}-${randomUUID().slice(0, 8)}`;
    const assignment = await claimApplicationWorkerAssignment({
      appOrigin,
      claim: {
        workerId,
        startedAt,
        acceptTask: true,
        active: 0,
        concurrency: 1,
        completed: 0,
        failed: 0,
        version: `vercel-${String(process.env.VERCEL_GIT_COMMIT_SHA || "production").slice(0, 12)}`,
      },
    });
    if (!assignment)
      return Response.json(
        { ok: true, state: "idle" },
        { headers: HEADERS },
      );
    const callback = await executeApplicationWorkerAssignment({
      assignment,
      appOrigin,
      // Leave enough time for the signed callback while allowing account
      // creation, email verification and a multi-step employer form to finish.
      budgetMs: 240_000,
    });
    await postApplicationWorkerCallback({
      task: assignment.task,
      callback,
      appOrigin,
    });
    return Response.json(
      {
        ok: true,
        state: callback.receipt?.state || "needs_user",
        applicationId: assignment.task.application_id,
      },
      { headers: HEADERS },
    );
  } catch (error) {
    if (error instanceof ApplicationWorkerRequestError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: HEADERS },
      );
    console.error("cloud_application_worker_failed", {
      reason: safeApplicationWorkerError(error).slice(0, 300),
    });
    return Response.json(
      { error: "The cloud application worker could not finish this task." },
      { status: 500, headers: HEADERS },
    );
  }
}
