import { z } from "zod";

export function readOnlyMaintenance(env: Record<string, string | undefined> = process.env): boolean {
  const value = z.enum(["true", "false"]).default("false").safeParse(env.IR35_READ_ONLY);
  return !value.success || value.data === "true";
}

export function blockedByMaintenance(method: string, pathname: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!readOnlyMaintenance(env)) return false;
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return true;
  // GET alone is not proof of read-only behaviour (cron/verification endpoints
  // can mutate). Permit only the explicitly audited public read surface.
  return method.toUpperCase() !== "OPTIONS" && pathname.startsWith("/api/")
    && !/^\/api\/(?:health|company-logo|jobs\/(?:search|[a-f0-9-]{36}))$/.test(pathname);
}

export const MAINTENANCE_MESSAGE = "Maintenance in progress. Your information is safe; please try again shortly.";
