import { pgBossOptions } from "../../src/lib/queue/config";

/** Validate every safety gate before constructing either database client. */
export function disposableQueuePermissionOptions() {
  if (process.env.NODE_ENV !== "test" || process.env.PG_BOSS_LOCAL_TEST !== "true" || !process.env.PG_BOSS_PRODUCER_TEST_DATABASE_URL)
    throw new Error("Queue permission probes require the explicit disposable local-test gates");
  const worker = pgBossOptions("worker");
  const producer = pgBossOptions("producer", process.env.PG_BOSS_PRODUCER_TEST_DATABASE_URL);
  for (const options of [worker, producer]) {
    const url = new URL(options.connectionString!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Queue probes require loopback Postgres");
  }
  return { worker, producer };
}
