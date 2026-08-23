import { randomUUID } from "node:crypto";
import {
  applicationWorkerAppOrigin,
  applicationWorkerConfig,
  signApplicationWorkerBody,
} from "@/lib/application-worker-auth";

export async function kickApplicationWorker(input?: {
  applicationId?: string;
  reason?: string;
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
