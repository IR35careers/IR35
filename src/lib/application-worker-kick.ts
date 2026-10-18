import { randomUUID } from "node:crypto";
import { APPLICATION_CLOUD_TOPIC, managedApplicationQueueEnabled } from "@/lib/application-cloud-queue";
import { isQueueApplyRunner } from "@/lib/application-runner-selection";
import {
  applicationWorkerAppOrigin,
  applicationWorkerConfig,
  signApplicationWorkerBody,
} from "@/lib/application-worker-auth";

export async function kickApplicationWorker(input?: {
  applicationId?: string;
  reason?: string;
  delaySeconds?: number;
}): Promise<"disabled" | "accepted" | "idle"> {
  if (!applicationWorkerConfig().enabled) return "disabled";
  const appOrigin = applicationWorkerAppOrigin(
    process.env.IR35CAREERS_APP_URL || "https://www.ir35careers.com",
  );
  const body = JSON.stringify({
    kickId: randomUUID(),
    applicationId: input?.applicationId || null,
    reason: (input?.reason || "application_queued").slice(0, 80),
    requestedAt: new Date().toISOString(),
  });
  if (isQueueApplyRunner()) {
    const { enqueueRailwayApplication } = await import("@/lib/queue/producer");
    await enqueueRailwayApplication(JSON.parse(body), input?.delaySeconds);
    return "accepted";
  }
  if (managedApplicationQueueEnabled()) {
    // Publish only opaque IDs. Candidate evidence and browser credentials stay
    // in Supabase and are fetched through the existing signed claim API.
    const { send } = await import("@vercel/queue");
    const message = JSON.parse(body);
    await send(APPLICATION_CLOUD_TOPIC, message, {
      region: "iad1",
      idempotencyKey: message.kickId,
      retentionSeconds: 604_800,
      delaySeconds: Math.max(0, Math.min(600, Math.ceil(input?.delaySeconds || 0))),
    });
    return "accepted";
  }
  if (input?.delaySeconds) await new Promise((resolve) => setTimeout(resolve, input.delaySeconds! * 1_000));
  const signed = signApplicationWorkerBody(body);
  const response = await fetch(`${appOrigin}/api/applications/worker/drain`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ir35-worker-timestamp": signed.timestamp,
      "x-ir35-worker-signature": signed.signature,
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(290_000),
  });
  if (!response.ok)
    throw new Error(`Cloud application worker returned HTTP ${response.status}.`);
  const result = (await response.json()) as { state?: string };
  return result.state === "idle" ? "idle" : "accepted";
}
