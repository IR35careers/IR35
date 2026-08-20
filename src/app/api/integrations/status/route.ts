import { getIntegrationStatuses } from "@/lib/integration-status";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });

  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) {
      return Response.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE });
    }
  } catch {
    return Response.json({ error: "Integration status is unavailable." }, { status: 503, headers: NO_STORE });
  }

  return Response.json(
    {
      integrations: getIntegrationStatuses(),
      generated_at: new Date().toISOString(),
      secret_values_exposed: false,
    },
    { headers: NO_STORE }
  );
}
