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
import { repairJobQuality } from "@/lib/pipeline/repair-job-quality";
import { timingSafeEqual } from "node:crypto";
import {
  ApplicationWorkerRequestError,
  readSignedApplicationWorkerJson,
} from "@/lib/application-worker-request";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

/** Manual operations use the existing worker credential; credentials never
 * enter a URL, browser bundle or log. The daily Vercel cron retains its GET
 * authentication independently. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readSignedApplicationWorkerJson(request, 2_000);
    if (body && typeof body === "object" && (body as Record<string, unknown>).action === "repair_job_quality") {
      const input = body as Record<string, unknown>;
      if (input.mode !== "preview" && input.mode !== "apply") return Response.json({ error: "Invalid repair mode" }, { status: 400, headers: NO_STORE });
      const summary = await repairJobQuality(input.mode, typeof input.planHash === "string" ? input.planHash : undefined);
      return Response.json({ ok: true, summary }, { headers: NO_STORE });
    }
    if (
      !body ||
      typeof body !== "object" ||
      (body as Record<string, unknown>).action !== "fetch_contract_jobs"
    )
      return Response.json(
        { error: "The contract refresh request is invalid." },
        { status: 400, headers: NO_STORE },
      );
    const summary = await runFetchPipeline();
    return Response.json({ ok: true, summary }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ApplicationWorkerRequestError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: NO_STORE },
      );
    console.error("contract_job_refresh_failed", {
      reason: error instanceof Error ? error.message.slice(0, 240) : "unknown",
    });
    return Response.json(
      { ok: false, error: "The contract refresh could not complete." },
      { status: 500, headers: NO_STORE },
    );
  }
}
