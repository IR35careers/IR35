import { isIP } from "node:net";
import type { ConstructorOptions } from "pg-boss";
import { z } from "zod";
import { queueDatabaseConnection } from "./database-connection";

export const MOCK_APPLY_QUEUE = "ir35-staging-mock-apply";
export const MOCK_SCHEDULE_QUEUE = "ir35-staging-mock-schedule";
export const STAGING_TEST_ACCOUNT = "anvesh.mannuru+ir35test@gmail.com";

/** No employer URL, CV, password or real application payload can enter here. */
export const mockApplicationWorkSchema = z.strictObject({
  kind: z.literal("staging_mock_application"),
  applicationId: z.uuid(),
  actorEmail: z.literal(STAGING_TEST_ACCOUNT),
  scenario: z.enum(["success", "server_error", "timeout", "lost_ack", "captcha", "unknown_answer"]),
  requestedAt: z.iso.datetime(),
});

export const mockScheduledWorkSchema = z.strictObject({
  kind: z.literal("staging_mock_schedule"),
  operation: z.enum(["mock_ingest", "mock_automation", "watchdog"]),
  requestedAt: z.iso.datetime(),
});

const configuration = z.object({
  APPLY_RUNNER: z.literal("mock"),
  IR35_STAGING: z.literal("true"),
  APPLICATION_WORKER_ACCEPT_JOBS: z.literal("false").default("false"),
  APPLICATION_WORKER_CONCURRENCY: z.literal("1").default("1"),
  APPLICATION_WORKER_SECRET: z.string().min(32).max(256),
  IR35CAREERS_APP_URL: z.url().refine(value => {
    const url = new URL(value);
    return url.origin === "https://staging.ir35careers.com" && url.pathname === "/"
      && !url.username && !url.password && !url.search && !url.hash;
  }),
  IR35_READ_ONLY: z.enum(["true", "false"]).default("true"),
  // Startup pause is distinct from the non-overridable read-only safety gate.
  IR35_MOCK_START_PAUSED: z.enum(["true", "false"]).default("false"),
  IR35_SCHEDULER_ENABLED: z.literal("false").default("false"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});

const directDataKeys = new Set([
  "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_INTERNAL_URL",
]);
const providerKey = /^(?:STRIPE_|RESEND_|POSTMARK_|OPENAI_|OPENROUTER_|AWS_|GOOGLE_|GITHUB_TOKEN$|GH_TOKEN$)/;

/** Prepared P6 contract only; not wired into the deployed/production runner. */
export function mockWorkerConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = configuration.safeParse(env);
  if (!parsed.success || env.VERCEL || Object.entries(env).some(([key, value]) => Boolean(value)
    && (directDataKeys.has(key) || providerKey.test(key)))) {
    // Never propagate Zod issues/input, credentials, URL or provider values.
    throw new Error("Mock worker requires isolated staging, acceptance=false, one browser, no direct data/provider credentials, and the staging control plane.");
  }
  return { ...parsed.data, mockConsumerEnabled: parsed.data.IR35_READ_ONLY === "false" };
}

/** Additional isolation beyond the shared verified-TLS/private-host validator. */
export async function mockQueueOptions(env: Record<string, string | undefined> = process.env): Promise<ConstructorOptions> {
  mockWorkerConfig(env);
  const connection = await queueDatabaseConnection(env.PG_BOSS_DATABASE_URL, env.QUEUE_DB_ALLOWED_HOSTS);
  const host = new URL(connection.connectionString).hostname.replace(/^\[|\]$/g, "");
  // ssl=false is returned ONLY after exact allowlisting + all-private DNS + IP
  // pinning. A public/cloud TLS database is valid for production, NEVER mocks.
  if (connection.ssl !== false || isIP(host) === 0) {
    throw new Error("Mock queue requires an explicitly allowlisted, validated and pinned private address; no public/cloud database is allowed.");
  }
  return { ...connection, schema: "pgboss", max: 2, connectionTimeoutMillis: 10_000,
    application_name: "ir35-staging-mock-worker", createSchema: false, migrate: false,
    supervise: true, schedule: false, registerInstance: true, instanceHeartbeatSeconds: 15,
    superviseIntervalSeconds: 15, monitorIntervalSeconds: 15 };
}
