import { PgBoss } from "pg-boss";
import { WORK_QUEUES, queueRuntimeOptions, queueName, workQueueOptions } from "../../src/lib/queue/config";

async function setup() {
  const boss = new PgBoss(await queueRuntimeOptions("setup"));
  boss.on("error", () => console.error("queue_setup_database_error"));
  try {
    await boss.start();
    for (const name of WORK_QUEUES) await boss.createQueue(queueName(name), workQueueOptions());
    console.info("queue_setup_completed", { schema: "pgboss", queues: WORK_QUEUES });
  } finally {
    await boss.stop({ graceful: false });
  }
}
void setup().catch(() => { console.error("Queue setup failed. Check schema ownership, validated host/TLS settings and queue credentials; values are never logged."); process.exitCode = 1; });
