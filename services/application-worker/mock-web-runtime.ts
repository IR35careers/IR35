import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import { MOCK_WEB_QUEUE, mockWebPolicy, mockWebKickSchema } from "../../src/lib/queue/mock-web-policy";
import { mockWebInternalPost, MOCK_WEB_CLAIM_PATH } from "../../src/lib/queue/mock-web-http";
import { mockWorkerConfig } from "../../src/lib/queue/mock-config";
import { mockOptions, runMockBrowser } from "./mock-runtime";
import { MockStore } from "./mock-store";
import { MockWebLedger, mockWebLedgerSQL } from "./mock-web-store";
import { processWebMockDelivery } from "./mock-web-engine";

export async function webMockOwnerOptions(env: Record<string, string | undefined>) {
  if (!mockWebPolicy(env) || env.PG_BOSS_PRODUCER_DATABASE_URL)
    throw new Error("The mock web consumer requires only its isolated queue-owner identity.");
  // Existing guard: private/pinned/exact queue role, no Supabase/provider keys,
  // acceptance=false, one browser, and NO production runner/config fallback.
  return { ...await mockOptions("worker", env), supervise: false, registerInstance: false };
}
export async function setupWebMockQueue(env: Record<string, string | undefined> = process.env): Promise<void> {
  const owner = new PgBoss(await webMockOwnerOptions(env));
  owner.on("error", () => { /* Only the fixed redacted entrypoint error is emitted. */ });
  try {
    await owner.start();
    // Intentionally NOT IF NOT EXISTS. An already-used setup slot must be
    // reconciled, never silently overwritten or treated as the correct ledger.
    await owner.getDb().executeSql(mockWebLedgerSQL);
    await owner.createQueue(MOCK_WEB_QUEUE, { policy: "short", retryLimit: 0, expireInSeconds: 120,
      heartbeatSeconds: 15, retentionSeconds: 86_400, deleteAfterSeconds: 86_400 });
  } finally { await owner.stop({ graceful: false }); }
}

/** Separate, off-by-default executable; importing it never starts a worker. */
export async function runWebMockWorker(env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = mockWorkerConfig(env), sha = z.string().regex(/^[a-f0-9]{40}$/).parse(env.IR35_BUILD_SHA);
  const owner = new PgBoss(await webMockOwnerOptions(env));
  try { await startWebMockWorker(owner, config, sha, env); }
  catch {
    await owner.stop({ graceful: false }).catch(() => undefined);
    throw new Error("Isolated web mock startup failed; no consumer was activated.");
  }
}
async function startWebMockWorker(owner: PgBoss, config: ReturnType<typeof mockWorkerConfig>, sha: string,
  env: Record<string, string | undefined>): Promise<void> {
  const shutdown = new AbortController();
  let lastDB = 0, lastControl = 0, active = 0, completed = 0, failed = 0, stopping = false, browserReady = false;
  let pumping: Promise<void> | undefined, observing: Promise<void> | undefined;
  const workerId = `staging-web-mock-${randomUUID()}`, startedAt = new Date().toISOString();
  const post = (path: string, value: unknown) => mockWebInternalPost(path, value, env);
  owner.on("error", () => { lastDB = 0; });
  await owner.start();
  const ledger = new MockWebLedger(owner), exclusion = new MockStore(owner, owner);
  const initial = await exclusion.browserLease();
  try { browserReady = (await runMockBrowser({ operation: "health" }, shutdown.signal)).browserReady === true; }
  finally { await initial.release(); }
  if (!browserReady) throw new Error("Isolated mock browser unavailable.");
  // Fail before listener/consumer activation if the separately provisioned
  // ledger is absent or malformed. Never auto-create/repair it at runtime.
  await ledger.pending();
  async function observe() {
    await owner.getDb().executeSql("SELECT 1"); lastDB = Date.now();
    const result = z.object({ ok: z.literal(true), timedOut: z.number().int().nonnegative() }).parse(await post(MOCK_WEB_CLAIM_PATH, {
      kind: "staging_web_mock_heartbeat", workerId, startedAt, active, completed, failed, buildSha: sha,
    }));
    if (result.ok) lastControl = Date.now();
  }
  async function delivery(value: unknown) {
    active = 1;
    try {
      await processWebMockDelivery(value, { ledger, post, browserLease: () => exclusion.browserLease(),
        browser: scenario => runMockBrowser({ operation: "apply", scenario }, shutdown.signal) });
      completed++;
    } catch {
      failed++;
      // Validate before touching even the private queue ledger. Invalid queue
      // payloads may not create a synthetic canonical or watchdog record.
      const kick = mockWebKickSchema.safeParse(value);
      if (kick.success) await ledger.defer(kick.data);
      throw new Error("Mock delivery pending; inspect the private durable ledger.");
    } finally { active = 0; }
  }
  async function pump() {
    if (stopping || config.IR35_MOCK_START_PAUSED === "true") return;
    for (const kick of await ledger.pending()) {
      if (stopping) return;
      await delivery(kick).catch(() => undefined);
    }
    if (stopping) return;
    const [job] = await owner.fetch<unknown>(MOCK_WEB_QUEUE, { batchSize: 1 });
    if (!job) return;
    try { await delivery(job.data); await owner.complete(MOCK_WEB_QUEUE, job, { mockOnly: true }); }
    catch { await owner.fail(MOCK_WEB_QUEUE, job, { code: "mock_control_pending_no_browser_retry" }); }
  }
  await observe();
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store"); response.setHeader("content-type", "application/json");
    if (request.method !== "GET" || request.url !== "/health") { response.writeHead(404).end("{}"); return; }
    const databaseReady = Date.now() - lastDB < 45_000, controlReady = Date.now() - lastControl < 45_000;
    const ok = !stopping && browserReady && databaseReady && controlReady;
    response.writeHead(ok ? 200 : 503).end(JSON.stringify({ ok, browserReady, databaseReady, controlReady, active,
      mode: "staging-web-mock-only", realAcceptance: false, buildSHA: sha }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.PORT, "0.0.0.0", resolve); });
  // No queue fetch or periodic write can begin before EVERY startup check and
  // the health listener has succeeded. Supervision is off: only our queue is
  // fetched; the original P6 queues/ledger are never maintained by this runner.
  const consumer = setInterval(() => {
    if (pumping || stopping) return;
    pumping = pump().catch(() => { lastDB = 0; }).finally(() => { pumping = undefined; });
  }, 1_000).unref();
  const heartbeat = setInterval(() => {
    if (observing || stopping) return;
    observing = observe().catch(() => { lastControl = 0; }).finally(() => { observing = undefined; });
  }, 15_000).unref();
  const stop = async () => {
    if (stopping) return; stopping = true; shutdown.abort(); clearInterval(consumer); clearInterval(heartbeat);
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await Promise.allSettled([pumping, observing].filter((value): value is Promise<void> => Boolean(value)));
    await owner.stop({ graceful: false });
  };
  process.once("SIGTERM", () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once("SIGINT", () => { void stop().catch(() => { process.exitCode = 1; }); });
}
