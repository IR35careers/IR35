import { PgBoss } from "pg-boss";
import { APPLY_QUEUE, applicationKickSchema, queueRuntimeOptions, queueName, scheduledWorkSchema } from "./config";

/** Short-lived producer: no worker, timers, migrations or browser in Vercel. */
async function publish(name: string, data: object, delaySeconds = 0): Promise<void> {
  const options = await queueRuntimeOptions("producer");
  let boss: PgBoss | undefined;
  try {
    boss = new PgBoss(options);
    boss.on("error", () => { /* Caller receives a redacted publication failure. */ });
    await boss.start();
    const id = await boss.send(name, data, {
      startAfter: Math.max(0, Math.min(600, Math.ceil(delaySeconds))),
      retryLimit: 2,
      singletonKey: "applicationId" in data && typeof data.applicationId === "string"
        ? data.applicationId : name,
    });
    // A short-policy queue returns null when this key already has pending work.
    // That is an acknowledged duplicate, not permission to run a browser here.
    if (id !== null && typeof id !== "string") throw new Error("Queue insert not acknowledged.");
  } catch {
    throw new Error("The durable worker queue did not accept the job. No submission is confirmed.");
  } finally {
    try { await boss?.stop({ graceful: false, timeout: 5_000 }); }
    catch { throw new Error("The durable worker queue could not close safely. No submission is confirmed."); }
  }
}

export async function enqueueRailwayApplication(value: unknown, delaySeconds = 0): Promise<void> {
  const parsed = applicationKickSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid application queue message.");
  await publish(APPLY_QUEUE, parsed.data, delaySeconds);
}

export async function enqueueScheduledWork(operation: "ingest" | "automation"): Promise<void> {
  const data = scheduledWorkSchema.parse({ operation, requestedAt: new Date().toISOString() });
  await publish(queueName(operation === "ingest" ? "ingest" : "alerts"), data);
}
