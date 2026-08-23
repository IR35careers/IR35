import { createServer } from "node:http";
import { hostname } from "node:os";
import { chromium as playwrightChromium } from "playwright-core";
import { runNativeApplication } from "../../src/lib/application-runner/run";
import { signApplicationWorkerBody } from "../../src/lib/application-worker-auth";
import type {
  ApplicationWorkerAssignment,
  ApplicationWorkerCallback,
  ApplicationWorkerClaimRequest,
  ApplicationWorkerTaskRow,
} from "../../src/lib/application-worker-types";
import type { NativePortalSession } from "../../src/lib/application-submission";

const PORT = Math.max(1, Math.min(Number(process.env.PORT || 8787), 65_535));
const POLL_MS = Math.max(
  1_000,
  Math.min(Number(process.env.APPLICATION_WORKER_POLL_MS || 2_500), 30_000),
);
const CONCURRENCY = Math.max(
  1,
  Math.min(Number(process.env.APPLICATION_WORKER_CONCURRENCY || 2), 4),
);
const WORKER_ID = `${hostname().replace(/[^a-z0-9-]/gi, "-").slice(0, 50)}-${process.pid}`;
const WORKER_STARTED_AT = new Date().toISOString();
const WORKER_VERSION = process.env.APPLICATION_WORKER_VERSION?.trim().slice(0, 80) || "development";
const APP_ORIGIN = (() => {
  const url = new URL(
    process.env.IR35CAREERS_APP_URL || "https://www.ir35careers.com",
  );
  if (url.protocol !== "https:")
    throw new Error("IR35CAREERS_APP_URL must use HTTPS.");
  return url.origin;
})();

let active = 0;
let completed = 0;
let failed = 0;
let stopping = false;
let claiming = false;

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Application worker error")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function callbackUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== APP_ORIGIN ||
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
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  if (!response.ok)
    throw new Error(`IR35Careers worker API returned HTTP ${response.status}.`);
  if (raw.length > 2_000_000)
    throw new Error("IR35Careers worker API response was too large.");
  return JSON.parse(raw) as T;
}

async function postCallback(
  task: ApplicationWorkerTaskRow,
  payload: ApplicationWorkerCallback,
): Promise<void> {
  await signedPost(callbackUrl(task.callback_url), payload);
}

async function remoteVerificationCode(
  task: ApplicationWorkerTaskRow,
  alias: string,
  requestedAfter: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await signedPost<{ code?: string | null }>(
      `${APP_ORIGIN}/api/applications/worker/verification-code`,
      {
        userId: task.user_id,
        applicationId: task.application_id,
        alias,
        requestedAfter,
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

async function buildAndRun(assignment: ApplicationWorkerAssignment): Promise<{
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
    portalPassword: assignment.portalPassword,
    resolvePortalPassword: assignment.portalPassword
      ? async () => assignment.portalPassword
      : undefined,
    resolveEmailVerificationCode: candidate.automaticEmailVerification
      ? ({ requestedAfter }) =>
          remoteVerificationCode(
            task,
            candidate.email,
            requestedAfter,
          )
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

async function executeTask(assignment: ApplicationWorkerAssignment): Promise<void> {
  const task = assignment.task;
  let callback: ApplicationWorkerCallback;
  try {
    const result = await buildAndRun(assignment);
    callback = {
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
    callback = {
      taskId: task.id,
      userId: task.user_id,
      applicationId: task.application_id,
      idempotencyKey: task.idempotency_key,
      completedAt: new Date().toISOString(),
      error: safeError(error),
    };
  }

  try {
    await postCallback(task, callback);
    completed += 1;
  } catch (error) {
    failed += 1;
    console.error("worker_callback_failed", {
      taskId: task.id,
      reason: safeError(error),
    });
  }
}

async function claimTask(acceptTask: boolean): Promise<ApplicationWorkerAssignment | null> {
  const claim: ApplicationWorkerClaimRequest = {
    workerId: WORKER_ID,
    startedAt: WORKER_STARTED_AT,
    acceptTask,
    active,
    concurrency: CONCURRENCY,
    completed,
    failed,
    version: WORKER_VERSION,
  };
  const result = await signedPost<{ assignment?: ApplicationWorkerAssignment | null }>(
    `${APP_ORIGIN}/api/applications/worker/claim`,
    claim,
    30_000,
  );
  return result.assignment ?? null;
}

async function pump(): Promise<void> {
  if (stopping || claiming || active >= CONCURRENCY) return;
  claiming = true;
  try {
    while (!stopping && active < CONCURRENCY) {
      let assignment: ApplicationWorkerAssignment | null = null;
      try {
        assignment = await claimTask(true);
      } catch (error) {
        console.error("worker_claim_failed", { reason: safeError(error) });
        return;
      }
      if (!assignment?.task) return;
      active += 1;
      void executeTask(assignment).finally(() => {
        active -= 1;
        void pump();
      });
    }
  } finally {
    claiming = false;
  }
}

async function heartbeat(): Promise<void> {
  try {
    await claimTask(false);
  } catch (error) {
    console.error("worker_heartbeat_failed", { reason: safeError(error) });
  }
}

if (!process.env.CHROME_EXECUTABLE_PATH)
  process.env.CHROME_EXECUTABLE_PATH = playwrightChromium.executablePath();
if (!process.env.APPLICATION_RUNNER_BUDGET_MS)
  process.env.APPLICATION_RUNNER_BUDGET_MS = "300000";

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(
      JSON.stringify({
        ok: true,
        service: "ir35careers-application-worker",
        active,
        concurrency: CONCURRENCY,
        completed,
        failed,
      }),
    );
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.info("application_worker_ready", {
    workerId: WORKER_ID,
    port: PORT,
    concurrency: CONCURRENCY,
  });
});

const timer = setInterval(() => void pump(), POLL_MS);
const heartbeatTimer = setInterval(() => void heartbeat(), 15_000);
void heartbeat();
void pump();

function shutdown(): void {
  stopping = true;
  clearInterval(timer);
  clearInterval(heartbeatTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 20_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
