import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";

export const MAINTENANCE_BODY_LIMIT = 512;
export const MAINTENANCE_COMMAND_MAX_AGE_MS = 30_000;
const commandSchema = z.strictObject({ action: z.enum(["drain", "resume"]), operationId: z.uuid() });
export type MaintenanceCommand = z.infer<typeof commandSchema>;
type Phase = "idle" | "draining" | "drained" | "resuming" | "failed";

/** Failed/superseded reads cannot resurrect readiness using a stale zero. */
export class WorkerDatabaseObservation {
  private revision = 0;
  private observedAt: number | null = null;
  private submitting: number | null = null;
  begin() { return ++this.revision; }
  commit(revision: number, submitting: number, now: number) {
    if (revision !== this.revision) return;
    this.submitting = z.number().int().nonnegative().parse(submitting);
    this.observedAt = z.number().int().nonnegative().parse(now);
  }
  invalidate() { this.revision++; this.observedAt = null; this.submitting = null; }
  fail(revision: number) { if (revision === this.revision) this.invalidate(); }
  snapshot(now: number) {
    const fresh = this.observedAt !== null && now >= this.observedAt && now - this.observedAt < 45_000;
    return { databaseReady: fresh, submitting: fresh ? this.submitting : null };
  }
}

/** pg-boss can release an overrun handler before its actual callback settles. */
export class TrackedWorkerHandlers {
  private active = 0;
  private readonly idleWaiters = new Set<() => void>();
  get count() { return this.active; }
  async run<T>(handler: () => Promise<T>): Promise<T> {
    this.active++;
    try { return await handler(); }
    finally {
      this.active--;
      if (this.active === 0) { for (const resolve of this.idleWaiters) resolve(); this.idleWaiters.clear(); }
    }
  }
  whenIdle(): Promise<void> { return this.active === 0 ? Promise.resolve() : new Promise(resolve => this.idleWaiters.add(resolve)); }
}

/** Domain-separated from application claims/callbacks; never print inputs/output. */
export function signMaintenanceBody(secret: string, body: string, timestamp: string) {
  if (secret.trim().length < 32) throw new Error("Maintenance authentication is unavailable.");
  return createHmac("sha256", secret.trim()).update(`ir35-worker-maintenance-v1.${timestamp}.${body}`).digest("base64url");
}

export function readMaintenanceCommand(input: unknown): MaintenanceCommand | null {
  const parsed = z.strictObject({ secret: z.string().min(32), body: z.string().max(MAINTENANCE_BODY_LIMIT),
    timestamp: z.string().regex(/^\d{13}$/), signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    now: z.number().int().nonnegative(),
  }).safeParse(input);
  if (!parsed.success || Buffer.byteLength(parsed.data.body) > MAINTENANCE_BODY_LIMIT
    || Math.abs(parsed.data.now - Number(parsed.data.timestamp)) > MAINTENANCE_COMMAND_MAX_AGE_MS) return null;
  try {
    const expected = Buffer.from(signMaintenanceBody(parsed.data.secret, parsed.data.body, parsed.data.timestamp));
    const supplied = Buffer.from(parsed.data.signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const command = commandSchema.safeParse(JSON.parse(parsed.data.body));
    return command.success ? command.data : null;
  } catch { return null; }
}

/** Temporary polling maintenance, never an acceptance/cutover configuration change. */
export class WorkerMaintenance {
  private phase: Phase = "idle";
  private operationId: string | null = null;
  private lastResumedId: string | null = null;
  private resumeRequested = false;
  private task: Promise<void> = Promise.resolve();

  constructor(private readonly ports: {
    configuredToAccept: boolean;
    stopConsumers: () => Promise<void>;
    startConsumers: () => Promise<void>;
    initialOperationId?: string;
  }) {
    if (ports.initialOperationId !== undefined) {
      this.operationId = z.uuid().parse(ports.initialOperationId);
      this.phase = "drained"; // Updated container must pass health BEFORE starting consumers.
    }
  }

  snapshot() {
    return { phase: this.phase, operationId: this.operationId, safeToReplace: this.phase === "drained" };
  }

  request(input: unknown) {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid maintenance command.");
    const command = parsed.data;
    if (command.action === "drain") {
      if (this.phase !== "idle") {
        if (this.operationId !== command.operationId || this.phase === "failed") throw new Error("Maintenance operation conflict.");
        return this.snapshot(); // A lost HTTP acknowledgement must not stop a second set of workers.
      }
      if (this.lastResumedId === command.operationId) throw new Error("Maintenance operation already finished.");
      this.operationId = command.operationId; this.resumeRequested = false; this.phase = "draining";
      this.task = Promise.resolve().then(async () => {
        // offWork(wait:true) includes a fetch already in progress. active=0 alone is not sufficient.
        if (this.ports.configuredToAccept) await this.ports.stopConsumers();
        if (this.resumeRequested) await this.resumeConsumers(); else this.phase = "drained";
      }).catch(() => { this.phase = "failed"; });
    } else {
      if (this.phase === "idle" && this.lastResumedId === command.operationId) return this.snapshot();
      if (this.operationId !== command.operationId || this.phase === "failed") throw new Error("Maintenance operation conflict.");
      this.resumeRequested = true;
      if (this.phase === "drained") this.task = this.resumeConsumers().catch(() => { this.phase = "failed"; });
      // During draining, resume is armed for after all previous workers have stopped.
      // During resuming, do not register a duplicate set of consumers.
    }
    return this.snapshot();
  }

  private async resumeConsumers() {
    this.phase = "resuming";
    if (this.ports.configuredToAccept) await this.ports.startConsumers();
    this.lastResumedId = this.operationId; this.operationId = null;
    this.resumeRequested = false; this.phase = "idle";
  }

  /** Tests/controlled shutdown can await it; HTTP must not block for the ten-minute drain window. */
  settled() { return this.task; }
}

/** Bounded localhost control-plane endpoint. Secret/body/headers never enter logs or error text. */
export async function handleMaintenanceHttp(request: IncomingMessage, response: ServerResponse, ports: {
  secret: string;
  ready: () => boolean;
  controller: () => WorkerMaintenance | undefined;
}) {
  const send = (status: number, value: unknown) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  };
  if (request.method !== "POST" || request.url !== "/maintenance") { send(404, { error: "Not found" }); return; }
  if (!ports.ready() || !ports.controller()) { send(503, { error: "Worker is not ready for maintenance" }); return; }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) { request.resume(); send(415, { error: "JSON required" }); return; }
  try {
    request.setTimeout(5000, () => request.destroy());
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAINTENANCE_BODY_LIMIT) { request.resume(); send(413, { error: "Maintenance body too large" }); return; }
      chunks.push(bytes);
    }
    const command = readMaintenanceCommand({ secret: ports.secret, now: Date.now(), body: Buffer.concat(chunks).toString("utf8"),
      timestamp: request.headers["x-ir35-maintenance-timestamp"], signature: request.headers["x-ir35-maintenance-signature"],
    });
    if (!command) { send(401, { error: "Invalid maintenance authentication or command" }); return; }
    try { send(202, { maintenance: ports.controller()!.request(command) }); }
    catch { send(409, { error: "Maintenance operation conflict; inspect existing operation" }); }
  } catch { if (!response.headersSent) send(400, { error: "Maintenance request could not be read" }); }
}
