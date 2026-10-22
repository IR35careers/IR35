import { z } from "zod";

export function readOnlyMaintenance(env: Record<string, string | undefined> = process.env): boolean {
  const value = z.enum(["true", "false"]).default("false").safeParse(env.IR35_READ_ONLY);
  return !value.success || value.data === "true";
}

export function blockedByMaintenance(method: string, pathname: string, env: Record<string, string | undefined> = process.env): boolean {
  return readOnlyMaintenance(env) && (
    !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())
    || ["/api/pipeline/fetch", "/api/automation/run"].includes(pathname)
  );
}

export const MAINTENANCE_MESSAGE = "Maintenance in progress. Your information is safe; please try again shortly.";
