import { z } from "zod";
import { readOnlyMaintenance } from "../../src/lib/maintenance-mode";

export async function runSchedule(operation: unknown, env: Record<string, string | undefined>, fetcher: typeof fetch = fetch) {
  const name = z.enum(["ingest", "automation"]).parse(operation);
  // Timers are deliberately installed DISABLED. Copied staging accounts must
  // never be ingested/mailed/applied automatically, even with a valid secret.
  if (env.IR35_SCHEDULER_ENABLED !== "true" || env.IR35_STAGING === "true" || readOnlyMaintenance(env)) return "disabled";
  if (!z.enum(["oracle", "railway"]).safeParse(env.APPLY_RUNNER).success) throw new Error("Scheduler requires approved queue runtime");
  const secret = z.string().min(32).parse(env.CRON_SECRET);
  const path = name === "ingest" ? "/api/pipeline/fetch" : "/api/automation/run";
  const response = await fetcher(`http://127.0.0.1:3000${path}`, {
    method: "GET", headers: { authorization: `Bearer ${secret}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Internal scheduler enqueue failed");
  return "enqueued";
}
