/**
 * Pipeline trigger endpoint: GET /api/pipeline/fetch
 *
 * Two ways to call it, both requiring the CRON_SECRET env var:
 *   1. Vercel Cron (configured in vercel.json) — Vercel automatically sends
 *      `Authorization: Bearer ${CRON_SECRET}` when that env var exists.
 *   2. Manually in a browser: /api/pipeline/fetch?secret=YOUR_CRON_SECRET
 *
 * Returns the full pipeline summary as JSON — company errors included, so a
 * wrong ATS slug is immediately visible.
 */

import { runFetchPipeline } from "@/lib/pipeline/run-fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby-plan ceiling; keep the registry modest

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const authHeader = request.headers.get("authorization") ?? "";
  const querySecret = url.searchParams.get("secret") ?? "";
  const authorized = authHeader === `Bearer ${secret}` || querySecret === secret;

  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runFetchPipeline();
    return Response.json({ ok: true, summary });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
