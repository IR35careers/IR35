import { randomUUID } from "node:crypto";
import { z } from "zod";
import { signMaintenanceBody } from "./maintenance";

/** Disposable CI container only. No live credentials, endpoints or employer work. */
async function main() {
  if (process.env.NODE_ENV !== "test" || process.env.PG_BOSS_LOCAL_TEST !== "true"
    || process.env.APPLY_RUNNER !== "vercel" || process.env.APPLICATION_WORKER_ACCEPT_JOBS !== "false"
    || process.env.IR35CAREERS_APP_URL !== "https://mock.example.test"
    || process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_URL)
    throw new Error("Maintenance verification requires isolated non-consuming CI fixtures.");
  const secret = z.string().min(32).parse(process.env.APPLICATION_WORKER_SECRET);
  const schema = z.object({ ok: z.literal(true), mode: z.literal("standby"), browserReady: z.literal(true), databaseReady: z.literal(true),
    active: z.literal(0), submitting: z.literal(0), handlersActive: z.literal(0),
    maintenance: z.object({ phase: z.enum(["idle", "draining", "drained", "resuming", "failed"]), operationId: z.uuid().nullable(), safeToReplace: z.boolean() }),
  });
  async function health() {
    const response = await fetch("http://127.0.0.1:8787/health", { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("Standby health failed.");
    return schema.parse(await response.json());
  }
  async function command(action: "drain" | "resume", operationId: string, badSignature = false) {
    const body = JSON.stringify({ action, operationId }); const timestamp = String(Date.now());
    const response = await fetch("http://127.0.0.1:8787/maintenance", { method: "POST", body, signal: AbortSignal.timeout(3000), headers: {
      "content-type": "application/json", "x-ir35-maintenance-timestamp": timestamp,
      "x-ir35-maintenance-signature": badSignature ? "invalid" : signMaintenanceBody(secret, body, timestamp),
    } });
    await response.arrayBuffer(); return response.status;
  }
  async function waitFor(phase: "idle" | "drained", operationId: string | null) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const result = await health();
      if (result.maintenance.phase === phase && result.maintenance.operationId === operationId
        && result.maintenance.safeToReplace === (phase === "drained")) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Standby maintenance transition timed out.");
  }
  const operationId = randomUUID();
  if (process.env.APPLICATION_WORKER_UPDATE_OPERATION !== undefined) {
    const initial = z.uuid().parse(process.env.APPLICATION_WORKER_UPDATE_OPERATION);
    await waitFor("drained", initial);
    if (await command("resume", initial) !== 202) throw new Error("Updated standby did not resume.");
  }
  await waitFor("idle", null);
  if (await command("drain", operationId, true) !== 401) throw new Error("Unsigned drain accepted.");
  if (await command("drain", operationId) !== 202) throw new Error("Drain not acknowledged.");
  await waitFor("drained", operationId);
  if (await command("drain", operationId) !== 202) throw new Error("Repeated drain not idempotent.");
  if (await command("resume", randomUUID()) !== 409) throw new Error("Conflicting resume accepted.");
  if (await command("resume", operationId) !== 202) throw new Error("Resume not acknowledged.");
  await waitFor("idle", null);
  console.info("isolated_standby_maintenance_verified", { acceptedJobs: false, browserReady: true, databaseReady: true, drainResume: true });
}
void main().catch(() => { console.error("Isolated maintenance verification failed."); process.exit(1); });
