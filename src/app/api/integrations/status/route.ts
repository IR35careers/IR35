import { getIntegrationStatuses } from "@/lib/integration-status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    {
      integrations: getIntegrationStatuses(),
      generated_at: new Date().toISOString(),
      secret_values_exposed: false,
    },
    { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }
  );
}
