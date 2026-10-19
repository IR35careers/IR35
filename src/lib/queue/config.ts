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

export async function pgBossOptions(mode: "producer" | "worker" | "setup", databaseUrl = process.env.PG_BOSS_DATABASE_URL): Promise<ConstructorOptions> {
  const connection = await queueDatabaseConnection(databaseUrl, process.env.QUEUE_DB_ALLOWED_HOSTS);
  return {
    ...connection, schema: "pgboss",
    max: mode === "producer" ? 1 : 4,
    connectionTimeoutMillis: 10_000,
    application_name: `ir35-${mode}`,
    createSchema: false, migrate: mode === "setup",
    supervise: mode === "worker", schedule: false,
    registerInstance: mode === "worker", instanceHeartbeatSeconds: HEARTBEAT_SECONDS,
    superviseIntervalSeconds: 15, monitorIntervalSeconds: 15,
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
