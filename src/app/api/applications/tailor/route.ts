import { tailorResumeWithFastFallback } from "@/lib/ai/openrouter-tailoring";
import type { JobDetail } from "@/lib/job-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { consumeRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function tailoringLimit(): number {
  const configured = Number.parseInt(process.env.OPENROUTER_REQUESTS_PER_USER_PER_HOUR ?? "5", 10);
  return Number.isFinite(configured) ? Math.max(1, Math.min(configured, 30)) : 5;
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });
  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) return Response.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE });
    const rate = await consumeRateLimitKey("ai_tailoring", data.user.id, tailoringLimit(), 60 * 60_000);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
    const body = await readJsonBody<{ cvText?: string; job?: JobDetail }>(request, 180_000);
    if (!body.job?.id || !body.job.title || !body.job.company_name || typeof body.cvText !== "string") {
      return Response.json({ error: "A Resume and complete role are required." }, { status: 400, headers: NO_STORE });
    }
    const outcome = await tailorResumeWithFastFallback({ cvText: body.cvText, job: body.job });
    return Response.json(outcome, {
      headers: { ...NO_STORE, "Server-Timing": `tailoring;dur=${outcome.elapsedMs}` },
    });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    const message = error instanceof Error ? error.message : "AI tailoring failed.";
    const status = message === "AI tailoring is not configured." ? 503 : 502;
    return Response.json({ error: status === 503 ? message : "AI tailoring could not be completed. Your original Resume is unchanged." }, { status, headers: NO_STORE });
  }
}
