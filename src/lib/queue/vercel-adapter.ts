import type { ApplicationCloudKick } from "@/lib/application-cloud-queue";
import { APPLICATION_CLOUD_TOPIC } from "@/lib/application-cloud-queue";

/** The only runtime import of the Vercel SDK. Oracle never initializes it. */
export async function publishVercelKick(message: ApplicationCloudKick, delaySeconds = 0): Promise<void> {
  const { send } = await import("@vercel/queue");
  await send(APPLICATION_CLOUD_TOPIC, message, {
    region: "iad1", idempotencyKey: message.kickId, retentionSeconds: 604_800,
    delaySeconds: Math.max(0, Math.min(600, Math.ceil(delaySeconds))),
  });
}

export async function vercelQueueCallback(...args: Parameters<typeof import("@vercel/queue")["handleCallback"]>) {
  const { handleCallback } = await import("@vercel/queue");
  return handleCallback(...args);
}
