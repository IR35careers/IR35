import { z } from "zod";
import type { ConstructorOptions, Queue } from "pg-boss";
import { queueDatabaseConnection } from "./database-connection";

export const WORK_QUEUES = ["apply", "ingest", "enrich", "match", "tailor", "mail", "alerts"] as const;
export const queueName = (name: typeof WORK_QUEUES[number]) => `ir35-${name}`;
export const APPLY_QUEUE = queueName("apply");
export const HEARTBEAT_SECONDS = 15;

export const applicationKickSchema = z.strictObject({
  kickId: z.uuid(),
  applicationId: z.uuid().nullable().optional(),
  reason: z.string().min(1).max(80),
  requestedAt: z.iso.datetime(),
});

export const scheduledWorkSchema = z.strictObject({
  operation: z.enum(["ingest", "automation"]),
  requestedAt: z.iso.datetime(),
});

type QueueMode = "producer" | "worker" | "setup";

function queuePolicy(mode: QueueMode): ConstructorOptions {
  return { schema: "pgboss", max: mode === "producer" ? 1 : 4,
    connectionTimeoutMillis: 10_000, application_name: `ir35-${mode}`,
    createSchema: false, migrate: mode === "setup", supervise: mode === "worker", schedule: false,
    registerInstance: mode === "worker", instanceHeartbeatSeconds: HEARTBEAT_SECONDS,
    superviseIntervalSeconds: 15, monitorIntervalSeconds: 15 };
}

/** Normal producer/setup/standby entry points use the SAME validated boundary.
 * No test-mode bypass: a private host must be explicitly allowlisted and pinned.
 */
export async function queueRuntimeOptions(mode: QueueMode, databaseUrl = process.env.PG_BOSS_DATABASE_URL): Promise<ConstructorOptions> {
  if (!z.enum(["producer", "worker", "setup"]).safeParse(mode).success) throw new Error("Invalid queue connection mode.");
  const connection = await queueDatabaseConnection(databaseUrl, process.env.QUEUE_DB_ALLOWED_HOSTS);
  return { ...connection, ...queuePolicy(mode) };
}

/** Historical synchronous contract retained for explicit disposable permission
 * probes and compatibility tests ONLY; normal runtime entry points await above.
 */
export function pgBossOptions(mode: QueueMode, databaseUrl = process.env.PG_BOSS_DATABASE_URL): ConstructorOptions {
  // Never include a parser error or connection string in an error/log.
  const raw = z.string().min(1).safeParse(databaseUrl);
  let connection: URL;
  let localTest = false;
  try {
    connection = new URL(raw.success ? raw.data : "");
    localTest = process.env.NODE_ENV === "test" && process.env.PG_BOSS_LOCAL_TEST === "true" &&
      ["127.0.0.1", "localhost"].includes(connection.hostname);
    if (!/^postgres(?:ql)?:$/.test(connection.protocol) ||
      (!localTest && !connection.hostname.endsWith(".pooler.supabase.com")) ||
      connection.port !== "5432" || connection.pathname !== "/postgres" ||
      !connection.username || !connection.password || connection.hash)
      throw new Error();
  } catch {
    throw new Error("PG_BOSS_DATABASE_URL must use the Supabase session pooler on port 5432 and database postgres.");
  }
  // pg-connection-string can override SSL objects when sslmode is in the URL.
  // Keep verification explicit and disallow arbitrary connection parameters.
  connection.search = "";
  const ca = process.env.PG_BOSS_SSL_CA?.replace(/\\n/g, "\n");
  return {
    connectionString: connection.toString(),
    ssl: localTest ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    ...queuePolicy(mode),
  };
}

export function workQueueOptions(): Omit<Queue, "name"> {
  return {
    policy: "short", retryLimit: 2, retryDelay: 60, retryBackoff: true,
    expireInSeconds: 600, heartbeatSeconds: 60,
    retentionSeconds: 86_400, deleteAfterSeconds: 86_400,
  };
}

export function queueWorkerConfig() {
  const result = z.object({
    APPLY_RUNNER: z.enum(["vercel", "railway", "oracle"]).default("vercel"),
    APPLICATION_WORKER_SECRET: z.string().min(32),
    IR35CAREERS_APP_URL: z.url().refine(value => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password &&
        url.pathname === "/" && !url.search && !url.hash;
    }),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    APPLICATION_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
    APPLICATION_WORKER_ACCEPT_JOBS: z.enum(["true", "false"]).default("false"),
    APPLICATION_WORKER_VERSION: z.string().min(1).max(80).default("queue-prepared"),
    // Ephemeral local updater override, not an acceptance/cutover setting.
    APPLICATION_WORKER_UPDATE_OPERATION: z.uuid().optional(),
  }).safeParse(process.env);
  if (!result.success || (result.data.APPLICATION_WORKER_ACCEPT_JOBS === "true" && result.data.APPLY_RUNNER === "vercel"))
    throw new Error("Invalid queue worker environment. Consumption requires an approved queue runner. Check docs/deploy-worker.md; values are never logged.");
  return result.data;
}

/** Compatibility for the original Railway preparation; no host API is called. */
export const railwayWorkerConfig = queueWorkerConfig;
