import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NativePortalSession } from "@/lib/application-submission";

const VERSION = "v1";
const SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_STATE_BYTES = 750_000;
const STORAGE_BUCKET = "application-portal-sessions";

function storagePath(userId: string, applicationId: string): string {
  return `${userId}/${applicationId}.session`;
}

async function ensureStorageBucket(admin: SupabaseClient): Promise<void> {
  const existing = await admin.storage.getBucket(STORAGE_BUCKET);
  if (!existing.error && existing.data) return;
  const created = await admin.storage.createBucket(STORAGE_BUCKET, {
    public: false,
    fileSizeLimit: 1_000_000,
    allowedMimeTypes: ["application/octet-stream"],
  });
  if (
    created.error &&
    !/(already exists|duplicate)/i.test(created.error.message)
  )
    throw new Error(created.error.message);
}

async function loadStorageSession(input: {
  admin: SupabaseClient;
  userId: string;
  applicationId: string;
}): Promise<NativePortalSession | null> {
  const downloaded = await input.admin.storage
    .from(STORAGE_BUCKET)
    .download(storagePath(input.userId, input.applicationId));
  if (downloaded.error || !downloaded.data) return null;
  try {
    const envelope = JSON.parse(await downloaded.data.text()) as {
      expiresAt?: string;
      encryptedState?: string;
    };
    if (
      !envelope.expiresAt ||
      new Date(envelope.expiresAt).getTime() <= Date.now() ||
      !envelope.encryptedState
    ) {
      await input.admin.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath(input.userId, input.applicationId)]);
      return null;
    }
    return openPortalSession(envelope.encryptedState);
  } catch {
    await input.admin.storage
      .from(STORAGE_BUCKET)
      .remove([storagePath(input.userId, input.applicationId)]);
    return null;
  }
}

async function saveStorageSession(input: {
  admin: SupabaseClient;
  userId: string;
  applicationId: string;
  session: NativePortalSession;
}): Promise<void> {
  await ensureStorageBucket(input.admin);
  const envelope = JSON.stringify({
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    encryptedState: sealPortalSession(input.session),
  });
  const uploaded = await input.admin.storage
    .from(STORAGE_BUCKET)
    .upload(
      storagePath(input.userId, input.applicationId),
      Buffer.from(envelope, "utf8"),
      {
        contentType: "application/octet-stream",
        cacheControl: "no-store",
        upsert: true,
      },
    );
  if (uploaded.error) throw new Error(uploaded.error.message);
}

function sessionSecret(): string {
  const secret =
    process.env.PORTAL_SESSION_SECRET?.trim() ||
    process.env.APPLICATION_ACCOUNT_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("Portal session encryption is not configured.");
  return secret;
}

function key(): Buffer {
  return createHash("sha256")
    .update(`ir35careers:portal-session:${sessionSecret()}`)
    .digest();
}

export function sealPortalSession(session: NativePortalSession): string {
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  if (plaintext.byteLength > MAX_STATE_BYTES)
    throw new Error("Employer session is too large to store safely.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, encrypted]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

export function openPortalSession(value: string): NativePortalSession {
  const [version, ivValue, tagValue, encryptedValue, ...extra] = value.split(".");
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    !encryptedValue ||
    extra.length
  )
    throw new Error("Employer session format is invalid.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]);
  if (plaintext.byteLength > MAX_STATE_BYTES)
    throw new Error("Employer session is too large to open safely.");
  const parsed = JSON.parse(plaintext.toString("utf8")) as NativePortalSession;
  if (
    !parsed ||
    !parsed.storageState ||
    !Array.isArray(parsed.storageState.cookies) ||
    !Array.isArray(parsed.storageState.origins)
  )
    throw new Error("Employer session data is invalid.");
  return parsed;
}

export async function loadPortalSession(input: {
  admin: SupabaseClient;
  userId: string;
  applicationId: string;
}): Promise<NativePortalSession | null> {
  const { data, error } = await input.admin
    .from("application_portal_sessions")
    .select("encrypted_state, expires_at")
    .eq("user_id", input.userId)
    .eq("application_id", input.applicationId)
    .maybeSingle();
  if (error) return loadStorageSession(input);
  if (!data) return loadStorageSession(input);
  if (new Date(String(data.expires_at)).getTime() <= Date.now()) {
    await clearPortalSession(input);
    return null;
  }
  try {
    return openPortalSession(String(data.encrypted_state));
  } catch {
    await clearPortalSession(input);
    return null;
  }
}

export async function savePortalSession(input: {
  admin: SupabaseClient;
  userId: string;
  applicationId: string;
  destinationHost: string;
  session: NativePortalSession;
}): Promise<void> {
  const now = new Date();
  const { error } = await input.admin.from("application_portal_sessions").upsert(
    {
      user_id: input.userId,
      application_id: input.applicationId,
      destination_host: input.destinationHost.toLowerCase(),
      encrypted_state: sealPortalSession(input.session),
      expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      updated_at: now.toISOString(),
    },
    { onConflict: "application_id" },
  );
  if (error) {
    await saveStorageSession(input);
    return;
  }
  await input.admin.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath(input.userId, input.applicationId)])
    .catch(() => null);
}

export async function clearPortalSession(input: {
  admin: SupabaseClient;
  userId: string;
  applicationId: string;
}): Promise<void> {
  const { error } = await input.admin
    .from("application_portal_sessions")
    .delete()
    .eq("user_id", input.userId)
    .eq("application_id", input.applicationId);
  const storageResult = await input.admin.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath(input.userId, input.applicationId)]);
  if (
    error &&
    storageResult.error &&
    !/(not found|does not exist)/i.test(storageResult.error.message)
  )
    throw new Error(error.message);
}
