import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "application-browser-handoffs";
const VERSION = 1;
const HANDOFF_TTL_MS = 60 * 60 * 1_000;
const TOKEN_BYTES = 32;

export interface ApplicationBrowserHandoff {
  version: 1;
  userId: string;
  applicationId: string;
  destination: string;
  createdAt: string;
  expiresAt: string;
  claimedAt?: string;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function storagePath(token: string): string {
  return `${tokenHash(token)}.json`;
}

function validToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,60}$/.test(token);
}

async function ensureBucket(admin: SupabaseClient): Promise<void> {
  const existing = await admin.storage.getBucket(STORAGE_BUCKET);
  if (!existing.error && existing.data) return;
  const created = await admin.storage.createBucket(STORAGE_BUCKET, {
    public: false,
    fileSizeLimit: 32_000,
    allowedMimeTypes: ["application/json"],
  });
  if (created.error && !/(already exists|duplicate)/i.test(created.error.message))
    throw new Error(created.error.message);
}

async function writeRecord(
  admin: SupabaseClient,
  token: string,
  record: ApplicationBrowserHandoff,
): Promise<void> {
  await ensureBucket(admin);
  const result = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath(token), Buffer.from(JSON.stringify(record), "utf8"), {
      contentType: "application/json",
      cacheControl: "no-store",
      upsert: true,
    });
  if (result.error) throw new Error(result.error.message);
}

export async function createApplicationBrowserHandoff(input: {
  admin: SupabaseClient;
  userId: string;
  applicationId: string;
  destination: string;
}): Promise<{ token: string; record: ApplicationBrowserHandoff }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const createdAt = new Date();
  const record: ApplicationBrowserHandoff = {
    version: VERSION,
    userId: input.userId,
    applicationId: input.applicationId,
    destination: input.destination,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + HANDOFF_TTL_MS).toISOString(),
  };
  await writeRecord(input.admin, token, record);
  return { token, record };
}

export async function loadApplicationBrowserHandoff(input: {
  admin: SupabaseClient;
  token: string;
  claim?: boolean;
}): Promise<ApplicationBrowserHandoff | null> {
  if (!validToken(input.token)) return null;
  const downloaded = await input.admin.storage
    .from(STORAGE_BUCKET)
    .download(storagePath(input.token));
  if (downloaded.error || !downloaded.data) return null;
  try {
    const record = JSON.parse(await downloaded.data.text()) as ApplicationBrowserHandoff;
    if (
      record.version !== VERSION ||
      !/^[0-9a-f-]{36}$/i.test(record.userId) ||
      !/^[0-9a-f-]{36}$/i.test(record.applicationId) ||
      !record.destination.startsWith("https://") ||
      new Date(record.expiresAt).getTime() <= Date.now()
    ) {
      await clearApplicationBrowserHandoff(input);
      return null;
    }
    if (input.claim && !record.claimedAt) {
      record.claimedAt = new Date().toISOString();
      await writeRecord(input.admin, input.token, record);
    }
    return record;
  } catch {
    await clearApplicationBrowserHandoff(input);
    return null;
  }
}

export async function clearApplicationBrowserHandoff(input: {
  admin: SupabaseClient;
  token: string;
}): Promise<void> {
  if (!validToken(input.token)) return;
  await input.admin.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath(input.token)])
    .catch(() => null);
}
