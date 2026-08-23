import { createServer } from "node:http";
import { hostname } from "node:os";
import { chromium as playwrightChromium } from "playwright-core";
import { applicationWorkerAppOrigin } from "../../src/lib/application-worker-auth";
import {
  claimApplicationWorkerAssignment,
  executeApplicationWorkerAssignment,
  postApplicationWorkerCallback,
  safeApplicationWorkerError,
} from "../../src/lib/application-worker-executor";
import type {
  ApplicationWorkerAssignment,
  ApplicationWorkerClaimRequest,
} from "../../src/lib/application-worker-types";

const PORT = Math.max(1, Math.min(Number(process.env.PORT || 8787), 65_535));
const POLL_MS = Math.max(
  1_000,
  Math.min(Number(process.env.APPLICATION_WORKER_POLL_MS || 30_000), 60_000),
);
const CONCURRENCY = Math.max(
  1,
  Math.min(Number(process.env.APPLICATION_WORKER_CONCURRENCY || 2), 4),
);
const WORKER_ID = `${hostname().replace(/[^a-z0-9-]/gi, "-").slice(0, 50)}-${process.pid}`;
const WORKER_STARTED_AT = new Date().toISOString();
const WORKER_VERSION = process.env.APPLICATION_WORKER_VERSION?.trim().slice(0, 80) || "development";
const APP_ORIGIN = applicationWorkerAppOrigin(process.env.IR35CAREERS_APP_URL);

let active = 0;
let completed = 0;
let failed = 0;
let stopping = false;
let claiming = false;

async function executeTask(assignment: ApplicationWorkerAssignment): Promise<void> {
  const task = assignment.task;
  const callback = await executeApplicationWorkerAssignment({
    assignment,
    appOrigin: APP_ORIGIN,
  });

  try {
    await postApplicationWorkerCallback({
      task,
      callback,
      appOrigin: APP_ORIGIN,
    });
    completed += 1;
  } catch (error) {
    failed += 1;
    console.error("worker_callback_failed", {
      taskId: task.id,
      reason: safeApplicationWorkerError(error),
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
  return claimApplicationWorkerAssignment({ appOrigin: APP_ORIGIN, claim });
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
        console.error("worker_claim_failed", {
          reason: safeApplicationWorkerError(error),
        });
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
    console.error("worker_heartbeat_failed", {
      reason: safeApplicationWorkerError(error),
    });
  }
}

if (!process.env.CHROME_EXECUTABLE_PATH)
  process.env.CHROME_EXECUTABLE_PATH = playwrightChromium.executablePath();
if (!process.env.APPLICATION_RUNNER_BUDGET_MS)
  process.env.APPLICATION_RUNNER_BUDGET_MS = "300000";
if (!process.env.APPLICATION_RUNNER_HEADLESS)
  process.env.APPLICATION_RUNNER_HEADLESS = "false";

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
const heartbeatTimer = setInterval(() => void heartbeat(), 30_000);
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
