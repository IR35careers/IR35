import { PgBoss } from "pg-boss";
import { disposableQueuePermissionOptions } from "./queue-permission-config";
import { verifyQueuePermissions } from "./queue-permission-check";

async function main() {
  // This destructive probe is NEVER a production verification command.
  const { worker: ownerOptions, producer: producerOptions } = disposableQueuePermissionOptions();
  const worker = new PgBoss({ ...ownerOptions, supervise: false, registerInstance: false });
  const producer = new PgBoss(producerOptions);
  worker.on("error", () => console.error("queue_permission_worker_error"));
  producer.on("error", () => console.error("queue_permission_producer_error"));
  try {
    await worker.start();
    await producer.start();
    const result = await verifyQueuePermissions(worker, producer);
    console.info("queue_permission_check_passed", result);
  } finally {
    await Promise.all([worker.stop({ graceful: false }), producer.stop({ graceful: false })]);
  }
}
void main().catch(() => { console.error("Queue permission verification failed; no credentials or query output are logged."); process.exitCode = 1; });
