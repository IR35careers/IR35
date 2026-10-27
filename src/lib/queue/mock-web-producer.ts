import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { PgBoss, type ConstructorOptions } from "pg-boss";
import { queueDatabaseConnection } from "./database-connection";
import { MOCK_WEB_QUEUE, mockWebKickSchema, mockWebPolicy } from "./mock-web-policy";

const UNAVAILABLE = "The isolated mock queue did not acknowledge delivery. No submission is confirmed.";
// Startup's return value is intentionally unused. The actual runtime remains
// PgBoss; fixture clients need not construct a real pool to return an instance.
type Producer = Pick<PgBoss, "on" | "send" | "stop"> & { start: () => Promise<unknown> };

/** One pool/one connection for the whole web process. It never receives the
 * queue-owner credential and never creates/migrates/supervises a queue.
 */
export function createMockWebPublisher(env: Record<string, string | undefined>,
  create: (options: ConstructorOptions) => Producer = options => new PgBoss(options)) {
  let cached: Promise<Producer> | undefined;
  let binding: string | undefined;
  const fingerprint = () => createHash("sha256").update(JSON.stringify([
    env.PG_BOSS_DATABASE_URL, env.QUEUE_DB_ALLOWED_HOSTS,
  ])).digest("hex");
  async function producer() {
    if (!mockWebPolicy(env)) throw new Error(UNAVAILABLE);
    if (binding && binding !== fingerprint()) throw new Error(UNAVAILABLE);
    if (!cached) {
      binding = fingerprint();
      cached = (async () => {
        const connection = await queueDatabaseConnection(env.PG_BOSS_DATABASE_URL, env.QUEUE_DB_ALLOWED_HOSTS);
        const url = new URL(connection.connectionString);
        if (decodeURIComponent(url.username) !== "ir35_queue_producer" || connection.ssl !== false
          || !isIP(url.hostname.replace(/^\[|\]$/g, ""))) throw new Error(UNAVAILABLE);
        const boss = create({ ...connection, schema: "pgboss", max: 1, connectionTimeoutMillis: 10_000,
          application_name: "ir35-staging-web-mock-producer", createSchema: false, migrate: false,
          supervise: false, schedule: false, registerInstance: false });
        boss.on("error", () => { /* Never propagate database credentials/parser errors. */ });
        try { await boss.start(); return boss; }
        catch { await boss.stop({ graceful: false }).catch(() => undefined); throw new Error(UNAVAILABLE); }
      })();
    }
    return cached;
  }
  return {
    async publish(value: unknown): Promise<void> {
      try {
        const parsed = mockWebKickSchema.parse(value);
        const policy = mockWebPolicy(env);
        if (!policy) throw new Error(UNAVAILABLE);
        policy.scenarioFor(parsed.jobId);
        const boss = await producer();
        const id = await boss.send(MOCK_WEB_QUEUE, parsed, {
          singletonKey: `${parsed.applicationId}:${parsed.deliveryVersion}`, retryLimit: 0,
        });
        // The pre-created short-policy queue acknowledges a pending duplicate
        // with null. Browser deduplication also lives in the canonical SQL lease.
        if (id !== null && typeof id !== "string") throw new Error(UNAVAILABLE);
      } catch { throw new Error(UNAVAILABLE); }
    },
    async close(): Promise<void> {
      const current = cached; cached = undefined; binding = undefined;
      if (current) await current.then(boss => boss.stop({ graceful: false })).catch(() => undefined);
    },
  };
}

let publisher: ReturnType<typeof createMockWebPublisher> | undefined;
export async function publishMockWebApplication(value: unknown): Promise<void> {
  publisher ??= createMockWebPublisher(process.env);
  await publisher.publish(value);
}
