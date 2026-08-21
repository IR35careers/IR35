import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { privacyHash } from "@/lib/security/privacy-hash";

type MemoryEntry = { startedAt: number; count: number };
const globalStore = globalThis as typeof globalThis & { __ir35SecurityRateStore?: Map<string, MemoryEntry> };
const memoryStore = globalStore.__ir35SecurityRateStore ?? new Map<string, MemoryEntry>();
globalStore.__ir35SecurityRateStore = memoryStore;

function requestAddress(request: Request): string {
  return (request.headers.get("x-vercel-forwarded-for")
    || request.headers.get("x-forwarded-for")
    || request.headers.get("x-real-ip")
    || "unknown")
    .split(",", 1)[0]
    .trim()
    .slice(0, 100);
}

function consumeMemory(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const current = memoryStore.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    memoryStore.set(key, { startedAt: now, count: 1 });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  return {
    allowed: current.count <= limit,
    retryAfter: Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1_000)),
  };
}

export async function consumeRateLimitKey(
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const key = privacyHash(`rate:${scope}`, identifier);
  const memory = consumeMemory(`${scope}:${key}`, limit, windowMs);
  if (!memory.allowed) return memory;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return memory;
  try {
    const admin = getSupabaseAdmin();
    const atomic = await admin.rpc("consume_security_rate_limit", {
      p_scope: scope,
      p_rate_key: key,
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1_000)),
    });
    if (!atomic.error) {
      const result = Array.isArray(atomic.data) ? atomic.data[0] : atomic.data;
      const allowed = Boolean((result as { allowed?: unknown } | null)?.allowed);
      const retryAfter = Number((result as { retry_after?: unknown } | null)?.retry_after ?? 0);
      if (Math.random() < 0.01) {
        await admin.from("moderation_logs")
          .delete()
          .eq("run_type", "security_rate_limit")
          .lt("created_at", new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString());
      }
      return { allowed, retryAfter: allowed ? 0 : Math.max(1, retryAfter || Math.ceil(windowMs / 1_000)) };
    }

    // Compatibility path while migration 017 is being rolled out. Once the
    // RPC exists, the advisory lock above is the authoritative durable guard.
    const since = new Date(Date.now() - windowMs).toISOString();
    const existing = await admin
      .from("moderation_logs")
      .select("id", { count: "exact", head: true })
      .eq("run_type", "security_rate_limit")
      .eq("summary->>rate_key", key)
      .eq("summary->>scope", scope)
      .gte("created_at", since);
    if (existing.error) throw existing.error;
    if ((existing.count ?? 0) >= limit) return { allowed: false, retryAfter: Math.ceil(windowMs / 1_000) };
    const inserted = await admin.from("moderation_logs").insert({
      run_type: "security_rate_limit",
      summary: { rate_key: key, scope },
    });
    if (inserted.error) throw inserted.error;
  } catch {
    // The process-local guard remains active if the durable audit store is
    // temporarily unavailable. Requests never receive details about storage.
  }
  return memory;
}

export async function consumePublicRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  return consumeRateLimitKey(scope, requestAddress(request), limit, windowMs);
}

export function rateLimitResponse(retryAfter: number): Response {
  return Response.json(
    { error: "Too many requests. Please wait before trying again." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, retryAfter)) } },
  );
}
