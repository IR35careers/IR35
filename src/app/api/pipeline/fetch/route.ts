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

  const authHeader = request.headers.get("authorization") ?? "";
  const authorized = authHeader === `Bearer ${secret}`;

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
