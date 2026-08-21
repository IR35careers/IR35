import { fetchCompany } from "@/lib/ats";
import { HttpClient } from "@/lib/ats/http-client";
import {
  EMPLOYER_ONBOARDING_RUN_TYPE,
  employerOnboardingRateKey,
  requestEmployerDestinationVerification,
  validateEmployerOnboardingInput,
} from "@/lib/employer-onboarding";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "ir35careers.com"
      || host === "www.ir35careers.com"
      || host === "admin.ir35careers.com"
      || (process.env.NODE_ENV !== "production" && (host === "localhost" || host === "127.0.0.1"));
  } catch {
    return false;
  }
}

function requestIp(request: Request): string {
  return (request.headers.get("x-forwarded-for")?.split(",")[0]
    || request.headers.get("x-real-ip")
    || "").trim().slice(0, 80);
}

async function rateLimitExceeded(input: { ipKey: string; emailKey: string }): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [ipResult, emailResult] = await Promise.all([
    admin.from("moderation_logs").select("id", { count: "exact", head: true })
      .eq("run_type", EMPLOYER_ONBOARDING_RUN_TYPE).contains("summary", { ip_key: input.ipKey }).gte("created_at", hourAgo),
    admin.from("moderation_logs").select("id", { count: "exact", head: true })
      .eq("run_type", EMPLOYER_ONBOARDING_RUN_TYPE).contains("summary", { email_key: input.emailKey }).gte("created_at", dayAgo),
  ]);
  if (ipResult.error || emailResult.error) throw new Error("Unable to check onboarding limits.");
  return (ipResult.count ?? 0) >= 8 || (emailResult.count ?? 0) >= 3;
}

export async function POST(request: Request): Promise<Response> {
  if (!allowedOrigin(request)) return Response.json({ error: "This request must be started from IR35Careers." }, { status: 403, headers: NO_STORE });
  try {
    const payload = await readJsonBody<Record<string, unknown>>(request, 8_192);
    if (typeof payload.website === "string" && payload.website.trim()) {
      return Response.json({ ok: true, message: "Check the recruitment inbox to continue." }, { status: 202, headers: NO_STORE });
    }
    const onboarding = validateEmployerOnboardingInput(payload);
    const ip = requestIp(request);
    const ipKey = employerOnboardingRateKey("ip", ip || `${onboarding.recruitmentEmail}:no-ip`);
    const emailKey = employerOnboardingRateKey("email", onboarding.recruitmentEmail);
    if (await rateLimitExceeded({ ipKey, emailKey })) {
      return Response.json({ error: "Too many verification requests. Try again later or contact IR35Careers." }, { status: 429, headers: { ...NO_STORE, "Retry-After": "3600" } });
    }
    const admin = getSupabaseAdmin();
    const attempt = await admin.from("moderation_logs").insert({
      run_type: EMPLOYER_ONBOARDING_RUN_TYPE,
      summary: {
        action: "started",
        ip_key: ipKey,
        email_key: emailKey,
        source_type: onboarding.type,
        source_slug: onboarding.slug,
        requested_at: new Date().toISOString(),
      },
    });
    if (attempt.error) throw new Error("Unable to record the onboarding request.");
    const verification = await fetchCompany(new HttpClient({
      minDelayMs: 0,
      timeoutMs: 8_000,
      maxRetries: 1,
      baseBackoffMs: 300,
    }), { name: onboarding.companyName, type: onboarding.type, slug: onboarding.slug });
    if (verification.error) {
      return Response.json({ error: `We could not verify that public ${onboarding.type} board. Check the provider and board identifier.` }, { status: 400, headers: NO_STORE });
    }
    const delivery = await requestEmployerDestinationVerification({
      source: { name: onboarding.companyName, type: onboarding.type, slug: onboarding.slug },
      recruitmentEmail: onboarding.recruitmentEmail,
      requestedBy: onboarding.recruitmentEmail,
      contactName: onboarding.contactName,
      requestKind: "employer_self_service",
      client: admin,
    });
    return Response.json({
      ok: true,
      message: "Verification sent. Confirm it from the recruitment inbox within 24 hours.",
      publishedJobsFound: verification.jobs.length,
      expiresAt: delivery.expiresAt,
    }, { status: 202, headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start employer onboarding.";
    if (error instanceof RequestBodyError) return Response.json({ error: message }, { status: error.status, headers: NO_STORE });
    const status = /configured|accepted for delivery|record employer verification/i.test(message) ? 503 : 400;
    return Response.json({ error: message }, { status, headers: NO_STORE });
  }
}
