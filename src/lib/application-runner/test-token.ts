import { createHmac, timingSafeEqual } from "node:crypto";

const TEST_TOKEN_TTL_MS = 5 * 60 * 1000;

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET?.trim() || "";
}

function signature(expiresAt: string): string {
  return createHmac("sha256", secret()).update(`application-runner-test:${expiresAt}`).digest("base64url");
}

export function createApplicationRunnerTestToken(now = Date.now()): string {
  if (!secret()) throw new Error("The admin test secret is not configured.");
  const expiresAt = String(now + TEST_TOKEN_TTL_MS);
  return `${expiresAt}.${signature(expiresAt)}`;
}

export function verifyApplicationRunnerTestToken(value: string, now = Date.now()): boolean {
  if (!secret()) return false;
  const [expiresAt, supplied, extra] = value.split(".");
  if (!expiresAt || !supplied || extra || !/^\d{13}$/.test(expiresAt) || Number(expiresAt) < now) return false;
  const expected = signature(expiresAt);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}
