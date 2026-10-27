import { createServer } from "node:http";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import { APPLY_QUEUE, applicationKickSchema, queueRuntimeOptions, queueWorkerConfig, queueName, scheduledWorkSchema, HEARTBEAT_SECONDS } from "../../src/lib/queue/config";
import { claimApplicationWorkerAssignment, executeApplicationWorkerAssignment, postApplicationWorkerCallback } from "../../src/lib/application-worker-executor";
import { getSupabaseAdmin } from "../../src/lib/supabase-admin";
import { signApplicationWorkerBody } from "../../src/lib/application-worker-auth";
import { runFetchPipeline } from "../../src/lib/pipeline/run-fetch";
import { runScheduledAutoApply } from "../../src/lib/automation/scheduled-runner";
import { reconcileCloudApplications } from "../../src/lib/application-cloud-reconcile";
import { handleRailwayApplication, LeaseDeferred } from "./railway-handler";
import { handleMaintenanceHttp, TrackedWorkerHandlers, WorkerDatabaseObservation, WorkerMaintenance } from "./maintenance";
import { readOnlyMaintenance } from "../../src/lib/maintenance-mode";

async function main() {
  const config = queueWorkerConfig();
  const origin = config.IR35CAREERS_APP_URL.replace(/\/$/, "");
  const accepting = config.APPLICATION_WORKER_ACCEPT_JOBS === "true" && !readOnlyMaintenance();
  if (accepting && (!process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL || (process.env.CRON_SECRET?.length || 0) < 32))
    throw new Error("Consuming work requires Supabase server credentials and the shared scheduler secret.");
  const boss = new PgBoss(await queueRuntimeOptions("worker"));
  const hostLabel = config.APPLY_RUNNER === "vercel" ? "queue" : config.APPLY_RUNNER;
  const workerId = `${hostLabel}-${hostname().replace(/[^a-z0-9-]/gi, "-").slice(0, 45)}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  let stopping = false, browserReady = false, active = 0, completed = 0, failed = 0;
  let lastReconciledAt = 0;
  let maintenanceReady = false;
  const trackedHandlers = new TrackedWorkerHandlers();
  const databaseHealth = new WorkerDatabaseObservation();
  boss.on("error", () => { databaseHealth.invalidate(); console.error("queue_database_error"); });
  const server = createServer((request, response) => {
    if (request.url === "/maintenance") {
      void handleMaintenanceHttp(request, response, { secret: config.APPLICATION_WORKER_SECRET,
        ready: () => !stopping && maintenanceReady, controller: () => maintenance });
      return;
    }
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404).end(); return;
    }
    const { databaseReady, submitting } = databaseHealth.snapshot(Date.now());
    const maintenanceState = maintenanceReady ? maintenance?.snapshot() : null;
    const ok = !stopping && databaseReady && browserReady && maintenanceState?.phase !== "failed";
    response.writeHead(ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok, service: "ir35-queue-worker", mode: accepting ? "consumer" : "standby", active, completed, failed,
      browserReady, databaseReady, submitting, handlersActive: trackedHandlers.count,
      maintenance: maintenanceState ? { ...maintenanceState, safeToReplace: ok && maintenanceState.safeToReplace && submitting === 0 && trackedHandlers.count === 0 } : null }));
  });
  server.listen(config.PORT, "0.0.0.0");
  process.env.CHROME_EXECUTABLE_PATH = chromium.executablePath();
  process.env.APPLICATION_RUNNER_HEADLESS = "true";
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  await browser.close();
  browserReady = true;
  await boss.start();

  const pendingSchema = z.object({ status: z.string(), available_at: z.string().nullable(), lease_expires_at: z.string().nullable() });
  async function refreshHealth() {
    const revision = databaseHealth.begin();
    try {
      const queue = await boss.getQueue(APPLY_QUEUE);
      if (!queue) throw new Error("Run worker:queue:setup before starting the worker.");
      let running = 0;
      if (accepting) {
        const watchdog = await getSupabaseAdmin().rpc("fail_abandoned_application_tasks");
        if (watchdog.error) throw new Error("Worker watchdog migration is missing or unavailable.");
        const submitting = await getSupabaseAdmin().from("application_worker_tasks").select("id", { count: "exact", head: true }).eq("status", "running");
        if (submitting.error) throw new Error("Submitting count is unavailable.");
        running = z.number().int().nonnegative().parse(submitting.count);
        const result = await getSupabaseAdmin().from("application_worker_heartbeats").upsert({
          worker_id: workerId, started_at: startedAt, last_seen_at: new Date().toISOString(),
          active, concurrency: config.APPLICATION_WORKER_CONCURRENCY, completed, failed, version: config.APPLICATION_WORKER_VERSION,
        });
        if (result.error) throw new Error("Heartbeat persistence failed.");
        if (Date.now() - lastReconciledAt >= 60_000) {
          // Recover a web DB/queue publish gap without waiting for tomorrow's
          // cron. Only queued, already-approved task IDs enter this outbox.
          const pending = await getSupabaseAdmin().from("application_worker_tasks")
            .select("application_id").eq("status", "queued")
            .lte("available_at", new Date().toISOString()).order("created_at").limit(50);
          if (pending.error) throw new Error("Queue reconciliation failed.");
          for (const row of z.array(z.object({ application_id: z.uuid() })).parse(pending.data)) {
            await boss.send(APPLY_QUEUE, { kickId: randomUUID(), applicationId: row.application_id, reason: "worker_reconciliation", requestedAt: new Date().toISOString() }, { singletonKey: row.application_id });
          }
          lastReconciledAt = Date.now();
        }
      }
      databaseHealth.commit(revision, running, Date.now());
    } catch { databaseHealth.fail(revision); console.error("queue_worker_health_failed"); }
  }
  await refreshHealth();
  if (!databaseHealth.snapshot(Date.now()).databaseReady) throw new Error("Worker queue is not ready.");

  async function startConsumers() {
    if (!accepting) return;
    if (stopping) throw new Error("Worker is stopping.");
    await boss.work(APPLY_QUEUE, { localConcurrency: config.APPLICATION_WORKER_CONCURRENCY, batchSize: 1, heartbeatRefreshSeconds: HEARTBEAT_SECONDS }, async ([job]) => trackedHandlers.run(async () => {
      active++;
      try {
        const result = await handleRailwayApplication({
          data: job.data, signal: job.signal, workerId, startedAt, version: config.APPLICATION_WORKER_VERSION,
          claim: request => claimApplicationWorkerAssignment({ appOrigin: origin, claim: request }),
          pending: async id => {
            const { data, error } = await getSupabaseAdmin().from("application_worker_tasks").select("status,available_at,lease_expires_at").eq("application_id", id).maybeSingle();
            if (error) throw new Error("Pending lease could not be read.");
            return data ? pendingSchema.parse(data) : null;
          },
          execute: (assignment, signal) => executeApplicationWorkerAssignment({ assignment, appOrigin: origin, budgetMs: 300_000, signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]) }),
          callback: (assignment, callback) => postApplicationWorkerCallback({ task: assignment.task, callback, appOrigin: origin }),
        });
        if (result.state !== "idle") completed++;
      } catch (error) {
        if (error instanceof LeaseDeferred) {
          // Waiting for an existing lease is not a new employer attempt and
          // must not exhaust pg-boss's two transient retries before it expires.
          const kick = applicationKickSchema.parse(job.data);
          await boss.send(APPLY_QUEUE, kick, { startAfter: error.seconds, singletonKey: kick.applicationId || APPLY_QUEUE });
        } else { failed++; throw new Error("Application worker failed; inspect the saved application outcome before retrying."); }
      } finally { active--; }
    }));
    if (stopping) throw new Error("Worker is stopping.");
    await boss.work(queueName("ingest"), { batchSize: 1, heartbeatRefreshSeconds: HEARTBEAT_SECONDS }, async ([job]) => trackedHandlers.run(async () => {
      const command = scheduledWorkSchema.parse(job.data);
      if (command.operation !== "ingest") throw new Error("Invalid ingestion command.");
      await runFetchPipeline(undefined, async () => {
        const body = JSON.stringify({ action: "invalidate_public_jobs" });
        const signed = signApplicationWorkerBody(body);
        const response = await fetch(`${origin}/api/pipeline/fetch`, { method: "POST", body, headers: {
          "content-type": "application/json", "x-ir35-worker-timestamp": signed.timestamp, "x-ir35-worker-signature": signed.signature,
        }, signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error("Public job cache invalidation was not acknowledged.");
      });
    }));
    if (stopping) throw new Error("Worker is stopping.");
    await boss.work(queueName("alerts"), { batchSize: 1, heartbeatRefreshSeconds: HEARTBEAT_SECONDS }, async ([job]) => trackedHandlers.run(async () => {
      const command = scheduledWorkSchema.parse(job.data);
      if (command.operation !== "automation") throw new Error("Invalid automation command.");
      await runScheduledAutoApply({ origin });
      await reconcileCloudApplications();
    }));
  }
  const maintenance = new WorkerMaintenance({
    configuredToAccept: accepting,
    initialOperationId: config.APPLICATION_WORKER_UPDATE_OPERATION,
    stopConsumers: async () => {
      await Promise.all([APPLY_QUEUE, queueName("ingest"), queueName("alerts")].map(name => boss.offWork(name, { wait: true })));
      // Include orphaned/overrun callbacks, not only pg-boss's own wip count.
      await trackedHandlers.whenIdle();
      // Never report an old zero count after the last claim/callback. Older
      // concurrent refreshes cannot overwrite this post-drain observation.
      databaseHealth.invalidate();
      await refreshHealth();
    },
    startConsumers,
  });
  if (!config.APPLICATION_WORKER_UPDATE_OPERATION) await startConsumers();
  maintenanceReady = true;
  const timer = setInterval(() => void refreshHealth(), HEARTBEAT_SECONDS * 1000);
  const shutdown = async () => {
    if (stopping) return;
    stopping = true; clearInterval(timer);
    // Reject readiness immediately, stop fetching, and finish existing work.
    // The host/Compose draining grace must exceed this bounded window.
    const deadline = setTimeout(() => process.exit(1), 330_000).unref();
    await boss.stop({ graceful: true, timeout: 320_000 });
    clearTimeout(deadline); server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  console.info("queue_worker_ready", { mode: accepting ? "consumer" : "standby", concurrency: config.APPLICATION_WORKER_CONCURRENCY });
}
void main().catch(() => { console.error("Queue worker startup failed; check deployment configuration. No credentials or candidate data are logged."); process.exit(1); });
