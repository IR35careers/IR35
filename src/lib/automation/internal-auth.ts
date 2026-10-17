import { createHmac, timingSafeEqual } from "node:crypto";

const AUTHORIZATION_TTL_MS = 5 * 60_000;

function automationSecret(): string {
  return (
    process.env.CRON_SECRET?.trim() ||
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    ""
  );
}

function signature(input: { userId: string; timestamp: string }): string {
  return createHmac("sha256", automationSecret())
    .update(`scheduled-auto-apply:${input.timestamp}:${input.userId}`)
    .digest("base64url");
}

export function createScheduledAutoApplyAuthorization(input: {
  userId: string;
  now?: number;
}): { timestamp: string; signature: string } | null {
  if (automationSecret().length < 32) return null;
  const timestamp = String(input.now ?? Date.now());
  return {
    timestamp,
    signature: signature({ userId: input.userId, timestamp }),
  };
}

export function verifyScheduledAutoApplyAuthorization(input: {
  userId: string;
  timestamp: string;
  suppliedSignature: string;
  now?: number;
}): boolean {
  if (
    automationSecret().length < 32 ||
    !/^[0-9a-f-]{36}$/i.test(input.userId) ||
    !/^\d{13}$/.test(input.timestamp)
  )
    return false;

  const issuedAt = Number(input.timestamp);
  const now = input.now ?? Date.now();
  if (
    !Number.isFinite(issuedAt) ||
    issuedAt > now + 30_000 ||
    now - issuedAt > AUTHORIZATION_TTL_MS
  )
    return false;

  const expected = signature(input);
  const supplied = Buffer.from(input.suppliedSignature);
  const expectedBytes = Buffer.from(expected);
  return (
    supplied.length === expectedBytes.length &&
    timingSafeEqual(supplied, expectedBytes)
  );
}
