import { createHash } from "node:crypto";
import { getIntegrationStatuses } from "@/lib/integration-status";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function emailDomain(): string | null {
  const value = (process.env.INBOUND_EMAIL_DOMAIN ?? "").trim().toLowerCase().replace(/^@/, "");
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && value.includes(".") ? value : null;
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });

  const inbound = getIntegrationStatuses().find((item) => item.id === "inbound_email");
  const domain = emailDomain();
  if (inbound?.state !== "connected" || !domain) {
    return Response.json({ error: "Recruiter email is not connected yet." }, { status: 503, headers: NO_STORE });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return Response.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE });

    const stableId = createHash("sha256")
      .update(`${data.user.id}:${process.env.INBOUND_MAIL_SIGNING_SECRET}`)
      .digest("hex")
      .slice(0, 14);
    const alias = `apply-${stableId}@${domain}`;
    const forwardingEmail = data.user.email ?? "";
    const { error: saveError } = await admin.from("inbox_aliases").upsert({
      user_id: data.user.id,
      alias,
      forwarding_email: forwardingEmail,
      forwarding_enabled: false,
      provider_state: "connected",
      updated_at: new Date().toISOString(),
    });
    if (saveError) throw new Error(saveError.message);

    return Response.json({ alias, forwardingEmail, providerState: "connected" }, { status: 201, headers: NO_STORE });
  } catch {
    return Response.json({ error: "The private inbox could not be activated." }, { status: 500, headers: NO_STORE });
  }
}
