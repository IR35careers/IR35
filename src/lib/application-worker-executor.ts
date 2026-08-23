import { runNativeApplication } from "@/lib/application-runner/run";
import { signApplicationWorkerBody } from "@/lib/application-worker-auth";
import type {
  ApplicationWorkerAssignment,
  ApplicationWorkerCallback,
  ApplicationWorkerClaimRequest,
  ApplicationWorkerTaskRow,
} from "@/lib/application-worker-types";
import type { NativePortalSession } from "@/lib/application-submission";

export function safeApplicationWorkerError(error: unknown): string {
  return (error instanceof Error ? error.message : "Application worker error")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function callbackUrl(task: ApplicationWorkerTaskRow, appOrigin: string): string {
  const url = new URL(task.callback_url);
  if (
    url.protocol !== "https:" ||
    url.origin !== appOrigin ||
    url.pathname !== "/api/applications/worker/callback"
  )
    throw new Error("The worker callback destination is invalid.");
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function signedPost<T>(
  url: string,
  payload: unknown,
  timeoutMs = 60_000,
): Promise<T> {
  const body = JSON.stringify(payload);
  const signed = signApplicationWorkerBody(body);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ir35-worker-timestamp": signed.timestamp,
      "x-ir35-worker-signature": signed.signature,
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  if (!response.ok)
    throw new Error(`IR35Careers worker API returned HTTP ${response.status}.`);
  if (raw.length > 2_000_000)
    throw new Error("IR35Careers worker API response was too large.");
  return JSON.parse(raw) as T;
}

async function remoteVerificationCode(input: {
  task: ApplicationWorkerTaskRow;
  alias: string;
  requestedAfter: string;
  appOrigin: string;
}): Promise<string | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await signedPost<{ code?: string | null }>(
      `${input.appOrigin}/api/applications/worker/verification-code`,
      {
        userId: input.task.user_id,
        applicationId: input.task.application_id,
        alias: input.alias,
        requestedAfter: input.requestedAfter,
        providerSync: attempt % 5 === 0,
      },
      20_000,
    ).catch(() => ({ code: null }));
    if (result.code && /^[A-Z0-9-]{4,12}$/i.test(result.code))
      return result.code;
    if (attempt < 29)
      await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return null;
}

async function buildAndRun(
  assignment: ApplicationWorkerAssignment,
  appOrigin: string,
  budgetMs?: number,
): Promise<{
  receipt: Awaited<ReturnType<typeof runNativeApplication>>;
  portalSession?: NativePortalSession;
  clearPortalSession?: boolean;
}> {
  if (assignment.preflightError) throw new Error(assignment.preflightError);
  if (!assignment.payload)
    throw new Error("The worker assignment did not include an approved packet.");
  let portalSession: NativePortalSession | undefined;
  let clearPortalSession = false;
  const task = assignment.task;
  const candidate = assignment.payload.candidate;
  const receipt = await runNativeApplication(assignment.payload, {
    budgetMs,
    portalPassword: assignment.portalPassword,
    resolvePortalPassword: assignment.portalPassword
      ? async () => assignment.portalPassword
      : undefined,
    resolveEmailVerificationCode: candidate.automaticEmailVerification
      ? ({ requestedAfter }) =>
          remoteVerificationCode({
            task,
            alias: candidate.email,
            requestedAfter,
            appOrigin,
          })
      : undefined,
    loadPortalSession: candidate.portalAccountConsent
      ? async () => assignment.portalSession ?? null
      : undefined,
    savePortalSession: candidate.portalAccountConsent
      ? async (session) => {
          portalSession = session;
          clearPortalSession = false;
        }
      : undefined,
    clearPortalSession: candidate.portalAccountConsent
      ? async () => {
          portalSession = undefined;
          clearPortalSession = true;
        }
      : undefined,
  });
  return { receipt, portalSession, clearPortalSession };
}

export async function executeApplicationWorkerAssignment(input: {
  assignment: ApplicationWorkerAssignment;
  appOrigin: string;
  budgetMs?: number;
}): Promise<ApplicationWorkerCallback> {
  const task = input.assignment.task;
  if (input.assignment.preflightError) {
    const completedAt = new Date().toISOString();
    return {
      taskId: task.id,
      userId: task.user_id,
      applicationId: task.application_id,
      idempotencyKey: task.idempotency_key,
      completedAt,
      receipt: {
        state: "needs_user",
        providerSubmissionId: `preflight:${task.id}`,
        submittedAt: completedAt,
        message: input.assignment.preflightError,
        review: { action: input.assignment.preflightAction || "/profile" },
      },
    };
  }
  try {
    const result = await buildAndRun(
      input.assignment,
      input.appOrigin,
      input.budgetMs,
    );
    return {
      taskId: task.id,
      userId: task.user_id,
      applicationId: task.application_id,
      idempotencyKey: task.idempotency_key,
      completedAt: new Date().toISOString(),
      receipt: result.receipt,
      portalSession: result.portalSession,
      clearPortalSession: result.clearPortalSession,
    };
  } catch (error) {
    return {
      taskId: task.id,
      userId: task.user_id,
      applicationId: task.application_id,
      idempotencyKey: task.idempotency_key,
      completedAt: new Date().toISOString(),
      error: safeApplicationWorkerError(error),
    };
  }
}

export async function postApplicationWorkerCallback(input: {
  task: ApplicationWorkerTaskRow;
  callback: ApplicationWorkerCallback;
  appOrigin: string;
}): Promise<void> {
  await signedPost(
    callbackUrl(input.task, input.appOrigin),
    input.callback,
    60_000,
  );
}

export async function claimApplicationWorkerAssignment(input: {
  appOrigin: string;
  claim: ApplicationWorkerClaimRequest;
}): Promise<ApplicationWorkerAssignment | null> {
  const result = await signedPost<{
    assignment?: ApplicationWorkerAssignment | null;
  }>(`${input.appOrigin}/api/applications/worker/claim`, input.claim, 30_000);
  return result.assignment ?? null;
}
