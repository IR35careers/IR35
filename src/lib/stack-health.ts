import { z } from "zod";
import { supabaseTransport } from "@/lib/supabase-transport";
import { stagingHealthTargets } from "@/lib/staging-health-targets";

export type HealthState = "ready" | "unavailable" | "not-configured";

/** Bounded read probes only. No raw errors, URLs, keys or customer data escape. */
export async function stackHealth(fetcher: typeof fetch = fetch) {
  const checks: Record<"database" | "auth" | "storage" | "realtime" | "worker", HealthState> = {
    database: "not-configured", auth: "not-configured", storage: "not-configured", realtime: "not-configured", worker: "not-configured",
  };
  const sha = z.string().regex(/^[a-f0-9]{40}$/).safeParse(process.env.IR35_BUILD_SHA);
  const targets = stagingHealthTargets();
  if (!targets) {
    // Fail before ANY request: a misbound writable fixture must not report the
    // original stack's health or forward a key into a fallback endpoint.
    checks.realtime = "unavailable"; checks.worker = "unavailable";
    return { ok: false, checks, buildSHA: sha.success ? sha.data : "unknown" };
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (base && key) {
    const transport = supabaseTransport(fetcher);
    await Promise.all(([
      ["database", "/rest/v1/jobs?select=id&limit=0"],
      ["auth", "/auth/v1/health"],
      ["storage", "/storage/v1/status"],
    ] as const).map(async ([name, path]) => {
      try {
        const response = await transport(base + path, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(3000), redirect: "error" });
        checks[name] = response.ok ? "ready" : "unavailable";
        await response.body?.cancel();
      } catch { checks[name] = "unavailable"; }
    }));
  }
  // Private health endpoints are fixed service names, not caller-supplied URLs.
  if (process.env.SUPABASE_INTERNAL_URL && process.env.IR35_REALTIME_HEALTH_ENABLED === "true") {
    try {
      const response = await fetcher(targets.realtime, {
        headers: { Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY ?? ""}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000),
      });
      checks.realtime = response.ok ? "ready" : "unavailable";
      await response.body?.cancel();
    } catch { checks.realtime = "unavailable"; }
  }
  if (process.env.IR35_WORKER_HEALTH_ENABLED === "true") {
    try {
      const response = await fetcher(targets.worker, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) });
      const body = z.object({ ok: z.literal(true), browserReady: z.literal(true), databaseReady: z.literal(true) }).safeParse(await response.json());
      checks.worker = response.ok && body.success ? "ready" : "unavailable";
    } catch { checks.worker = "unavailable"; }
  }
  return { ok: Object.values(checks).every(value => value === "ready"), checks, buildSHA: sha.success ? sha.data : "unknown" };
}
