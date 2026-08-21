/**
 * Pipeline trigger endpoint: GET /api/pipeline/fetch
 *
 * Vercel Cron (configured in vercel.json) sends
 * `Authorization: Bearer ${CRON_SECRET}` when that env var exists. Manual
 * runs must use the same header; secrets are never accepted in URLs or logs.
 *
 * Returns the full pipeline summary as JSON — company errors included, so a
 * wrong ATS slug is immediately visible.
 */

import { runFetchPipeline } from "@/lib/pipeline/run-fetch";
import { isSevenAmInLondon } from "@/lib/pipeline/schedule";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby-plan ceiling; keep the registry modest

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function secureTokenEqual(presented: string, expected: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 500, headers: NO_STORE }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const authorized = secureTokenEqual(authHeader, `Bearer ${secret}`);

  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  // Vercel schedules in UTC. Two protected invocations cover GMT and BST;
  // only the one falling in London's 07:00 hour performs the daily refresh.
  // An explicitly authorised manual run is still allowed outside that hour.
  const isVercelCron = (request.headers.get("user-agent") ?? "").includes("vercel-cron/1.0");
  if (isVercelCron && !isSevenAmInLondon(new Date())) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "Outside the 07:00 Europe/London refresh window.",
    }, { headers: NO_STORE });
  }

  try {
    const summary = await runFetchPipeline();
    return Response.json({ ok: true, summary }, { headers: NO_STORE });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: NO_STORE }
    );
  }
}
