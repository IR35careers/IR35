import { resendInboundConfig } from "@/lib/email/resend";
import { ensureInboxAlias } from "@/lib/email/inbox-alias";
import { getIntegrationStatuses } from "@/lib/integration-status";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });

  const inbound = getIntegrationStatuses().find((item) => item.id === "inbound_email");
  const provider = resendInboundConfig();
  if (inbound?.state !== "connected" || !provider) {
    return Response.json({ error: "Recruiter email is not connected yet." }, { status: 503, headers: NO_STORE });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return Response.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE });

    const forwardingEmail = data.user.email ?? "";
    const inbox = await ensureInboxAlias(admin, data.user.id, forwardingEmail);
    if (!inbox) throw new Error("Recruiter email is not connected.");

    return Response.json({ alias: inbox.alias, forwardingEmail: inbox.forwardingEmail, forwardingEnabled: inbox.forwardingEnabled, providerState: "connected" }, { status: 201, headers: NO_STORE });
  } catch {
    return Response.json({ error: "The private inbox could not be activated." }, { status: 500, headers: NO_STORE });
  }
}
