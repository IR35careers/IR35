import { getIntegrationStatuses } from "@/lib/integration-status";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { resolveEmployerDestinationForJob } from "@/lib/employer-destinations";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });

  let verifiedEmployerDestination = false;
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) {
      return Response.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE });
    }
    const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
    if (/^[0-9a-f-]{36}$/i.test(jobId)) {
      const jobResult = await admin.from("jobs").select("id, company_name").eq("id", jobId).maybeSingle();
      if (!jobResult.error && jobResult.data) {
        verifiedEmployerDestination = Boolean(await resolveEmployerDestinationForJob(jobResult.data, admin));
      }
    }
  } catch {
    return Response.json({ error: "Integration status is unavailable." }, { status: 503, headers: NO_STORE });
  }

  const integrations = getIntegrationStatuses().map((integration) => integration.id === "ats_submission" && verifiedEmployerDestination
    ? {
      ...integration,
      state: "connected" as const,
      scope: "Verified employer recruitment delivery with final candidate approval.",
      nextStep: "This role can be submitted from IR35Careers.",
    }
    : integration);
  return Response.json(
    {
      integrations,
      generated_at: new Date().toISOString(),
      secret_values_exposed: false,
    },
    { headers: NO_STORE }
  );
}
