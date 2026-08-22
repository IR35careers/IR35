import { createHmac, timingSafeEqual } from "node:crypto";

const RESUME_TOKEN_TTL_MS = 5 * 60 * 1000;

function secret(): string {
  return (
    process.env.CRON_SECRET?.trim() ||
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    ""
  );
}

function signature(input: {
  applicationId: string;
  userId: string;
  timestamp: string;
}): string {
  return createHmac("sha256", secret())
    .update(
      `application-resume:${input.timestamp}:${input.userId}:${input.applicationId}`,
    )
    .digest("base64url");
}

export function createApplicationResumeAuthorization(input: {
  applicationId: string;
  userId: string;
  now?: number;
}): { timestamp: string; signature: string } | null {
  if (!secret()) return null;
  const timestamp = String(input.now ?? Date.now());
  return {
    timestamp,
    signature: signature({ ...input, timestamp }),
  };
}

export function verifyApplicationResumeAuthorization(input: {
  applicationId: string;
  userId: string;
  timestamp: string;
  suppliedSignature: string;
  now?: number;
}): boolean {
  if (!secret() || !/^\d{13}$/.test(input.timestamp)) return false;
  const issuedAt = Number(input.timestamp);
  const now = input.now ?? Date.now();
  if (
    !Number.isFinite(issuedAt) ||
    issuedAt > now + 30_000 ||
    now - issuedAt > RESUME_TOKEN_TTL_MS
  )
    return false;

  const expected = signature(input);
  const suppliedBytes = Buffer.from(input.suppliedSignature);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}
