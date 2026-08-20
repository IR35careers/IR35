import { openRouterTailoringConfig, tailorResumeWithOpenRouter } from "@/lib/ai/openrouter-tailoring";
import { buildLocalTailoringResult } from "@/lib/ai/local-tailoring";
import type { JobDetail } from "@/lib/job-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const WINDOW_MS = 60 * 60 * 1_000;

type RateEntry = { startedAt: number; count: number };
const rateStore = globalThis as typeof globalThis & { __ir35AiTailoringRateStore?: Map<string, RateEntry> };
const aiTailoringRateStore = rateStore.__ir35AiTailoringRateStore ?? new Map<string, RateEntry>();
rateStore.__ir35AiTailoringRateStore = aiTailoringRateStore;

function consumeTailoringAttempt(userId: string): boolean {
  const configured = Number.parseInt(process.env.OPENROUTER_REQUESTS_PER_USER_PER_HOUR ?? "5", 10);
  const limit = Number.isFinite(configured) ? Math.max(1, Math.min(configured, 30)) : 5;
  const now = Date.now();
  const current = aiTailoringRateStore.get(userId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    aiTailoringRateStore.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 180_000) return Response.json({ error: "The tailoring request is too large." }, { status: 413, headers: NO_STORE });

  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) return Response.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE });
    if (!consumeTailoringAttempt(data.user.id)) {
      return Response.json({ error: "You have reached the hourly tailoring limit. Review the existing suggestions or try again later." }, { status: 429, headers: { ...NO_STORE, "Retry-After": "3600" } });
    }
    const body = (await request.json()) as { cvText?: string; job?: JobDetail };
    if (!body.job?.id || !body.job.title || !body.job.company_name || typeof body.cvText !== "string") {
      return Response.json({ error: "A CV and complete role are required." }, { status: 400, headers: NO_STORE });
    }
    const result = openRouterTailoringConfig()
      ? await tailorResumeWithOpenRouter({ cvText: body.cvText, job: body.job })
      : buildLocalTailoringResult(body.cvText, body.job);
    return Response.json({ result }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI tailoring failed.";
    const status = message === "AI tailoring is not configured." ? 503 : 502;
    return Response.json({ error: status === 503 ? message : "AI tailoring could not be completed. Your original CV is unchanged." }, { status, headers: NO_STORE });
  }
}
