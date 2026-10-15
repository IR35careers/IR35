import { selectedApplyRunner } from "@/lib/application-runner-selection";

export const APPLICATION_CLOUD_TOPIC = "ir35-application-kicks";

export type ApplicationCloudKick = {
  kickId: string;
  applicationId?: string | null;
  reason: string;
  requestedAt: string;
};

export function validApplicationCloudKick(value: unknown): value is ApplicationCloudKick {
  if (!value || typeof value !== "object") return false;
  const kick = value as Record<string, unknown>;
  return typeof kick.kickId === "string" && /^[0-9a-f-]{36}$/i.test(kick.kickId)
    && (kick.applicationId == null || (typeof kick.applicationId === "string" && /^[0-9a-f-]{36}$/i.test(kick.applicationId)))
    && typeof kick.reason === "string" && kick.reason.length <= 80
    && typeof kick.requestedAt === "string" && Number.isFinite(Date.parse(kick.requestedAt));
}

export function managedApplicationQueueEnabled(): boolean {
  return process.env.VERCEL === "1" && selectedApplyRunner() === "vercel";
}

export class ApplicationLeasePending extends Error {
  constructor(public readonly afterSeconds: number) {
    super("The persisted application lease is not ready to claim.");
  }
}

export function applicationQueueRetry(error: unknown, deliveryCount: number): { afterSeconds: number } {
  return { afterSeconds: error instanceof ApplicationLeasePending
    ? Math.max(10, Math.min(600, error.afterSeconds))
    : Math.min(600, 30 * Math.max(1, deliveryCount)) };
}
