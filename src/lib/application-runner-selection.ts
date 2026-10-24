import { z } from "zod";

const runnerSchema = z.enum(["vercel", "railway", "oracle", "mock"]).default("vercel");

/** Missing configuration preserves production; typos must never select a runner. */
export function selectedApplyRunner(): "vercel" | "railway" | "oracle" | "mock" {
  const result = runnerSchema.safeParse(process.env.APPLY_RUNNER);
  if (!result.success) throw new Error("APPLY_RUNNER must be vercel, railway, oracle or isolated mock.");
  if (result.data === "mock" && (process.env.IR35_STAGING !== "true" || process.env.VERCEL === "1")) {
    throw new Error("Mock runner requires the isolated non-Vercel staging runtime.");
  }
  return result.data;
}

export function isQueueApplyRunner(): boolean {
  return selectedApplyRunner() !== "vercel";
}

export function applyRunnerExecution(): "railway_pg_boss" | "oracle_pg_boss" | "managed_cloud_queue" | "external_worker" | "mock_only" {
  const runner = selectedApplyRunner();
  return runner === "mock" ? "mock_only" : runner === "oracle" ? "oracle_pg_boss" : runner === "railway" ? "railway_pg_boss"
    : process.env.VERCEL === "1" ? "managed_cloud_queue" : "external_worker";
}
