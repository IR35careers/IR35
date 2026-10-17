import { createHmac } from "node:crypto";

function privacySecret(): string {
  const value = (process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || "").trim();
  if (value.length >= 32) return value;
  if (process.env.IR35CAREERS_E2E_DEMO_DATA === "1") {
    return "ir35careers-e2e-browser-tests-only-secret";
  }
  if (process.env.NODE_ENV === "production") throw new Error("A server privacy-hash secret is not configured.");
  return "ir35careers-local-development-privacy-secret";
}

export function privacyHash(namespace: string, value: string): string {
  return createHmac("sha256", privacySecret())
    .update(`${namespace}:${value.trim().toLowerCase()}`)
    .digest("hex");
}
