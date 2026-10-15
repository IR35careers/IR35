import { z } from "zod";

const runnerSchema = z.enum(["vercel", "railway"]).default("vercel");

/** Missing configuration preserves production; typos must never select a runner. */
export function selectedApplyRunner(): "vercel" | "railway" {
  const result = runnerSchema.safeParse(process.env.APPLY_RUNNER);
  if (!result.success) throw new Error("APPLY_RUNNER must be vercel or railway.");
  return result.data;
}
