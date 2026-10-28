import { z } from "zod";
import { mockWebPolicy } from "@/lib/queue/mock-web-policy";

const legacy = Object.freeze({
  realtime: "http://realtime-dev.supabase-realtime:4000/api/tenants/realtime-dev/health",
  worker: "http://worker:8787/health",
});
const ownedQa = Object.freeze({
  realtime: "http://ir35-p8-webqa01-realtime:4000/api/tenants/ir35-p8-webqa01/health",
  worker: "http://ir35-p8-webqa01-worker:8787/health",
});
const fixture = z.object({
  IR35_STAGING_HEALTH_FIXTURE: z.literal("webqa01"),
  IR35_STAGING_KONG_HOST: z.literal("ir35-p8-webqa01-kong"),
  SUPABASE_INTERNAL_URL: z.literal("http://ir35-p8-webqa01-kong:8000"),
  NEXT_PUBLIC_SUPABASE_URL: z.literal("https://staging.ir35careers.com/supabase"),
});

/** Fixed service targets, never caller-supplied URLs or a DNS alias added to
 * the shared network. Invalid fixture configuration cannot fall back to the
 * original worker/Realtime. This selects read probes only, not readiness.
 */
export function stagingHealthTargets(env: Record<string, string | undefined> = process.env):
  Readonly<{ realtime: string; worker: string }> | null {
  const isolated = env.IR35_MOCK_WEB_ENABLED === "true" || env.IR35_STAGING_KONG_HOST === "ir35-p8-webqa01-kong";
  if (!env.IR35_STAGING_HEALTH_FIXTURE && !isolated) return legacy;
  try {
    if (!fixture.safeParse(env).success || !mockWebPolicy(env)) return null;
    return ownedQa;
  } catch { return null; } // Never expose Zod input, credentials or URLs.
}
