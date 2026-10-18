import { handleCallback } from "@vercel/queue";
import { applicationQueueRetry, validApplicationCloudKick } from "@/lib/application-cloud-queue";
import { executeCloudApplication } from "@/lib/application-cloud-worker";
import { verifyCloudApplicationRuntime } from "@/lib/application-cloud-verification";
import { isQueueApplyRunner } from "@/lib/application-runner-selection";

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel's queue trigger makes this route private. The existing database lease
// prevents concurrent deliveries from applying twice to the same vacancy.
export const POST = handleCallback(async (message: unknown) => {
  if (!validApplicationCloudKick(message)) throw new Error("Invalid cloud application message.");
  if (isQueueApplyRunner()) {
    // Drain old queue deliveries into pg-boss during cutover; never run two
    // independent browser consumers. Remove this trigger after the drain.
    const { enqueueRailwayApplication } = await import("@/lib/queue/producer");
    await enqueueRailwayApplication(message);
    return;
  }
  if (message.reason === "cloud_runner_verification" && !message.applicationId) {
    await verifyCloudApplicationRuntime(message.kickId);
    return;
  }
  await executeCloudApplication(message);
}, {
  visibilityTimeoutSeconds: 360,
  retry: (error, metadata) => applicationQueueRetry(error, metadata.deliveryCount),
});
