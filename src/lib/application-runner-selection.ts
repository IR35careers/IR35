import { z } from "zod";

const runnerSchema = z.enum(["vercel", "railway", "oracle"]).default("vercel");

/** Missing configuration preserves production; typos must never select a runner. */
export function selectedApplyRunner(): "vercel" | "railway" | "oracle" {
  const result = runnerSchema.safeParse(process.env.APPLY_RUNNER);
  if (!result.success) throw new Error("APPLY_RUNNER must be vercel, railway or oracle.");
  return result.data;
}

export function isQueueApplyRunner(): boolean {
  return selectedApplyRunner() !== "vercel";
}

export function applyRunnerExecution(): "railway_pg_boss" | "oracle_pg_boss" | "managed_cloud_queue" | "external_worker" {
  const runner = selectedApplyRunner();
  return runner === "oracle" ? "oracle_pg_boss" : runner === "railway" ? "railway_pg_boss"
    : process.env.VERCEL === "1" ? "managed_cloud_queue" : "external_worker";
}
