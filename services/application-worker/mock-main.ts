import { readFile } from "node:fs/promises";
import { PgBoss } from "pg-boss";
import { MOCK_APPLY_QUEUE, MOCK_SCHEDULE_QUEUE } from "../../src/lib/queue/mock-config";
import { mockSchemaSQL } from "./mock-store";
import { mockOptions, runMockWorker } from "./mock-runtime";

async function main() {
  if (process.argv.slice(2).join() === "--run") return runMockWorker();
  if (process.argv.slice(2).join() !== "--setup") throw new Error("Explicit mock setup or run required.");
  const boss = new PgBoss(await mockOptions("setup")); boss.on("error", () => { /* Redacted outer failure only. */ });
  try {
    await boss.start();
    await boss.getDb().executeSql(mockSchemaSQL);
    for (const name of [MOCK_APPLY_QUEUE, MOCK_SCHEDULE_QUEUE]) await boss.createQueue(name, { policy: "short", retryLimit: 0,
      expireInSeconds: 60, heartbeatSeconds: 15, retentionSeconds: 86_400, deleteAfterSeconds: 86_400 });
    await boss.getDb().executeSql(await readFile("supabase/operations/pgboss-producer-grants.sql", "utf8"));
    console.log(JSON.stringify({ status: "PASS", queues: 2, mockOnly: true, realAcceptance: false }));
  } finally { await boss.stop({ graceful: false }); }
}
void main().catch(() => { console.error(JSON.stringify({ status: "FAIL", code: "IsolatedMockWorkerFailed", rawOutput: "withheld" })); process.exitCode = 1; });
