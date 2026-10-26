import { createServer, type IncomingMessage } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { PgBoss, type ConstructorOptions, type Job } from "pg-boss";
import { z } from "zod";
import { MOCK_APPLY_QUEUE, MOCK_SCHEDULE_QUEUE, mockApplicationWorkSchema, mockScheduledWorkSchema, mockWorkerConfig, mockQueueOptions } from "../../src/lib/queue/mock-config";
import { MockStore, mockFailure } from "./mock-store";
import { browserGroupKiller } from "./mock-process-tree";

const browserResult = z.object({ ok: z.boolean(), browserReady: z.boolean().optional(), receiptConfirmed: z.boolean().optional(),
  errorCode: mockFailure.optional(), submissions: z.number().int().min(0).max(1) });
export function browserEnvironment(env: Record<string, string | undefined>) {
  return { NODE_ENV: "production" as const, ...Object.fromEntries(["PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH"].flatMap(key => env[key] ? [[key, env[key]!]] : [])) };
}
export async function mockOptions(mode: "setup" | "worker" | "producer", env: Record<string, string | undefined> = process.env): Promise<ConstructorOptions> {
  const values = mode === "producer" ? { ...env, PG_BOSS_DATABASE_URL: env.PG_BOSS_PRODUCER_DATABASE_URL } : env;
  const options = await mockQueueOptions(values);
  if (decodeURIComponent(new URL(options.connectionString!).username) !== (mode === "producer" ? "ir35_queue_producer" : "ir35_queue")) throw new Error("Wrong isolated queue identity.");
  return { ...options, max: mode === "producer" ? 1 : 2, migrate: mode === "setup", supervise: mode === "worker", registerInstance: mode === "worker" };
}
export function mockSignature(secret: string, timestamp: string, method: string, path: string, body: string) {
  return createHmac("sha256", secret).update(`ir35-staging-mock-v1.${timestamp}.${method}.${path}.${body}`).digest("base64url");
}
export function authenticatedMockRequest(secret: string, timestamp: unknown, signature: unknown, method: string, path: string, body: string, now = Date.now()) {
  if (typeof timestamp !== "string" || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 30_000 || typeof signature !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const expected = Buffer.from(mockSignature(secret, timestamp, method, path, body)), actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function runMockBrowser(input: { operation: "health" | "apply"; scenario?: z.infer<typeof mockApplicationWorkSchema>["scenario"] }, signal?: AbortSignal) {
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "services/application-worker/mock-browser.ts"], {
      env: browserEnvironment(process.env), stdio: ["pipe", "pipe", "ignore"], detached: process.platform !== "win32",
    });
    let stdout = "", aborted = false, overflow = false, closed = false;
    let force: NodeJS.Timeout | undefined;
    const tree = process.platform === "linux" && child.pid ? browserGroupKiller(child.pid) : undefined;
    const stopGroup = (kind: NodeJS.Signals) => {
      if (!child.pid) return;
      try { if (tree) tree.signal(kind); else if (process.platform !== "win32") process.kill(-child.pid, kind); else child.kill(kind); } catch { /* Already closed. */ }
    };
    const abort = () => {
      if (aborted || closed) return;
      aborted = true; stopGroup("SIGTERM");
      // Do not release browser exclusion while a child ignoring SIGTERM can
      // still run. Kill this child's NEW group, never another worker's group.
      if (!closed) force = setTimeout(() => stopGroup("SIGKILL"), 5000).unref();
    };
    const deadline = setTimeout(abort, 60_000).unref();
    const cleanup = () => {
      closed = true; signal?.removeEventListener("abort", abort);
      if (force) clearTimeout(force); clearTimeout(deadline);
      stopGroup("SIGKILL");
      tree?.close();
    };
    child.stdout.on("data", part => { stdout += part; if (Buffer.byteLength(stdout) > 2048) { overflow = true; stopGroup("SIGKILL"); } });
    child.once("error", () => { cleanup(); reject(new Error("Mock browser child unavailable.")); });
    child.once("close", code => {
      // Reap any orphan Chromium in this child's NEW process group before the
      // DB browser exclusion is released; never kill another worker's group.
      cleanup();
      if (code === 0 && !aborted && !overflow) resolve(stdout); else reject(new Error("Mock browser child failed."));
    });
    child.stdin.on("error", () => { /* Exit/error above settles a closed pipe. */ });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdin.end(JSON.stringify(input));
  });
  return browserResult.parse(JSON.parse(result));
}
async function bodyOf(request: IncomingMessage) {
  let body = "";
  for await (const part of request) { body += part; if (Buffer.byteLength(body) > 4096) throw new Error("Mock request too large."); }
  return body;
}

export async function runMockWorker(env: Record<string, string | undefined> = process.env) {
  const config = mockWorkerConfig(env);
  const sha = z.string().regex(/^[a-f0-9]{40}$/).parse(env.IR35_BUILD_SHA);
  const owner = new PgBoss(await mockOptions("worker", env)), producer = new PgBoss(await mockOptions("producer", env));
  let stopping = false, paused = !config.mockConsumerEnabled || config.IR35_MOCK_START_PAUSED === "true", browserReady = false, active = 0, peakActive = 0, lastDB = 0;
  const applicationAborts = new Map<string, AbortController>();
  owner.on("error", () => { lastDB = 0; }); producer.on("error", () => { lastDB = 0; });
  await owner.start(); await producer.start();
  const store = new MockStore(owner, producer);
  const healthBrowser = await store.browserLease();
  try { browserReady = (await runMockBrowser({ operation: "health" })).browserReady === true; }
  finally { await healthBrowser.release(); }
  if (!browserReady) throw new Error("Native mock Chromium unavailable.");
  async function observe() { await store.watchdog(); await store.heartbeat(sha, active); lastDB = Date.now(); }
  await observe();
  async function handle(job: Job<unknown>) {
    const value = mockApplicationWorkSchema.safeParse(job.data);
    if (!value.success || value.data.applicationId !== job.id || !Number.isSafeInteger(job.retryCount) || job.retryCount < 0) throw new Error("Invalid isolated mock work.");
    const attempt = await store.claim(value.data.applicationId);
    if (!attempt) return { duplicate: true, noBrowser: true };
    active++; peakActive = Math.max(peakActive, active);
    const controller = new AbortController();
    applicationAborts.set(value.data.applicationId, controller);
    const signal = AbortSignal.any([job.signal, controller.signal]);
    let leaseLost = false, finished = false, renewal: Promise<void> | null = null;
    let heartbeat: NodeJS.Timeout | undefined;
    const renew = () => store.renew(value.data.applicationId, attempt, { id: job.id, retryCount: job.retryCount });
    async function stopRenewal() { finished = true; if (heartbeat) clearInterval(heartbeat); await renewal; }
    let lease: Awaited<ReturnType<MockStore["browserLease"]>> | undefined;
    try {
      await renew().catch(() => { leaseLost = true; throw new Error("Mock initial attempt lease lost."); });
      if (signal.aborted) throw new Error("Mock work cancelled before browser start.");
      heartbeat = setInterval(() => {
        if (finished || renewal) return;
        renewal = renew().catch(() => { leaseLost = true; controller.abort(); }).finally(() => { renewal = null; });
      }, 5000).unref();
      lease = await store.browserLease();
      await store.transition(value.data.applicationId, attempt, "submitting");
      const result = await runMockBrowser({ operation: "apply", scenario: value.data.scenario }, signal);
      await stopRenewal();
      if (signal.aborted || leaseLost) throw new Error("Mock browser no longer owns its live attempt.");
      if (result.ok && result.receiptConfirmed && result.submissions === 1) await store.transition(value.data.applicationId, attempt, "submitted");
      else await store.transition(value.data.applicationId, attempt, "failed", result.errorCode ?? "mock_browser_failed");
      if (!result.ok) throw new Error("Mock application failed; persisted reason is authoritative.");
      return { mock: true, receiptConfirmed: true };
    } catch {
      await stopRenewal();
      // Only an owned live lease can change state. Never replace an existing
      // terminal failure/unknown result or silently reset it to Ready.
      const saved = await store.get(value.data.applicationId);
      if (saved && ["running", "submitting"].includes(saved.state)) {
        await store.transition(value.data.applicationId, attempt, "failed", leaseLost ? "runner_timeout" : signal.aborted ? "mock_cancelled" : "mock_browser_failed");
      }
      throw new Error("Controlled mock failed; inspect its durable error code.");
    } finally {
      try { await stopRenewal(); await lease?.release(); }
      finally { applicationAborts.delete(value.data.applicationId); active--; }
    }
  }
  async function scheduled(job: Job<unknown>) {
    const value = mockScheduledWorkSchema.safeParse(job.data); if (!value.success) throw new Error("Invalid mock-only schedule.");
    if (value.data.operation === "watchdog") await store.watchdog();
    await owner.getDb().executeSql("INSERT INTO pgboss.ir35_mock_schedule(id,operation) VALUES($1,$2) ON CONFLICT DO NOTHING", [job.id, value.data.operation]);
    return { mock: true, operation: value.data.operation, realSideEffects: 0 };
  }
  // Manual pg-boss claims make maintenance a true pause, not a handler which
  // keeps claiming and failing pending jobs. A single in-flight tick owns the
  // only browser; the DB advisory lock additionally excludes other processes.
  let currentTick: Promise<void> | null = null;
  async function tick() {
    if (paused || stopping) return;
    const [job] = await owner.fetch<unknown>(MOCK_APPLY_QUEUE, { batchSize: 1 });
    if (job) {
      try { const output = await handle({ ...job, signal: AbortSignal.timeout(30_000) }); await owner.complete(MOCK_APPLY_QUEUE, job, output); }
      catch { await owner.fail(MOCK_APPLY_QUEUE, job, { code: "controlled_mock_failed_inspect_durable_receipt" }); }
    }
    if (paused || stopping) return;
    const [command] = await owner.fetch<unknown>(MOCK_SCHEDULE_QUEUE, { batchSize: 1 });
    if (command) {
      try { await owner.complete(MOCK_SCHEDULE_QUEUE, command, await scheduled(command)); }
      catch { await owner.fail(MOCK_SCHEDULE_QUEUE, command, { code: "invalid_mock_schedule" }); }
    }
  }
  const consumer = setInterval(() => {
    if (currentTick || paused || stopping) return;
    currentTick = tick().catch(() => { lastDB = 0; }).finally(() => { currentTick = null; });
  }, 1000).unref();
  const timer = setInterval(() => { void observe().catch(() => { lastDB = 0; }); }, 15_000).unref();
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("cache-control", "no-store"); response.setHeader("content-type", "application/json");
      const method = request.method ?? "", path = request.url ?? "";
      if (method === "GET" && path === "/health") {
        const databaseReady = lastDB > 0 && Date.now() - lastDB < 45_000;
        const ok = !stopping && databaseReady && browserReady;
        response.writeHead(ok ? 200 : 503).end(JSON.stringify({ ok, browserReady, databaseReady, mode: "staging-mock-only", realAcceptance: false, paused, active, peakActive, buildSHA: sha })); return;
      }
      const body = await bodyOf(request);
      if (!authenticatedMockRequest(config.APPLICATION_WORKER_SECRET, request.headers["x-ir35-mock-timestamp"], request.headers["x-ir35-mock-signature"], method, path, body)) { response.writeHead(401).end("{}"); return; }
      if (method === "POST" && path === "/mock/applications") {
        if (paused || stopping) { response.writeHead(503).end(JSON.stringify({ error: "mock_maintenance" })); return; }
        const receipt = await store.enqueue(JSON.parse(body));
        response.writeHead(202).end(JSON.stringify(receipt)); return;
      }
      const id = /^\/mock\/applications\/([0-9a-f-]{36})$/.exec(path)?.[1];
      if (method === "GET" && id) { const saved = await store.get(id); response.writeHead(saved ? 200 : 404).end(JSON.stringify(saved)); return; }
      const cancelled = /^\/mock\/applications\/([0-9a-f-]{36})\/cancel$/.exec(path)?.[1];
      if (method === "POST" && cancelled) {
        z.strictObject({}).parse(JSON.parse(body));
        const saved = await store.cancel(cancelled);
        if (saved?.errorCode === "mock_cancelled") applicationAborts.get(cancelled)?.abort();
        response.writeHead(saved ? 200 : 404).end(JSON.stringify(saved)); return;
      }
      if (method === "POST" && path === "/mock/maintenance") {
        const action = z.strictObject({ action: z.enum(["pause", "resume"]) }).parse(JSON.parse(body));
        paused = action.action === "pause" || !config.mockConsumerEnabled;
        if (paused) await currentTick;
        response.writeHead(200).end(JSON.stringify({ paused, realAcceptance: false })); return;
      }
      if (method === "POST" && path === "/mock/schedule") {
        if (paused || stopping) { response.writeHead(503).end("{}"); return; }
        const value = mockScheduledWorkSchema.safeParse(JSON.parse(body)); if (!value.success) throw new Error("Invalid mock schedule.");
        const id = await producer.send(MOCK_SCHEDULE_QUEUE, value.data, { singletonKey: value.data.operation });
        response.writeHead(202).end(JSON.stringify({ mock: true, queued: Boolean(id) })); return;
      }
      response.writeHead(404).end("{}");
    })().catch(() => { if (!response.headersSent) response.writeHead(400); response.end(JSON.stringify({ error: "invalid_mock_request_or_unavailable" })); });
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000; server.listen(config.PORT, "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
    stopping = true; paused = true; clearInterval(timer); clearInterval(consumer); server.close();
    for (const controller of applicationAborts.values()) controller.abort();
    void Promise.resolve(currentTick).finally(async () => {
      await Promise.all([owner.stop({ graceful: true, timeout: 60_000 }), producer.stop({ graceful: false })]);
      process.exit(0);
    });
  });
}
