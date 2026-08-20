import { getStripe, stripeManagementConfig } from "@/lib/billing/stripe";
import { requestUser } from "@/lib/request-user";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request): Promise<Response> {
  const config = stripeManagementConfig();
  if (!config) return Response.json({ error: "Billing management is not connected." }, { status: 503, headers: NO_STORE });
  const auth = await requestUser(request);
  if ("response" in auth) return auth.response;

  try {
    const entitlement = await getSupabaseAdmin().from("user_entitlements").select("provider_customer_id").eq("user_id", auth.user.id).maybeSingle();
    if (entitlement.error) throw entitlement.error;
    const customerId = entitlement.data?.provider_customer_id as string | null;
    if (!customerId) return Response.json({ error: "No billing account exists for this user." }, { status: 404, headers: NO_STORE });

    const stripe = getStripe(config);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${config.siteUrl}/billing`,
      ...(config.portalConfigurationId ? { configuration: config.portalConfigurationId } : {}),
    });
    return Response.json({ url: session.url }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Billing management could not be opened." }, { status: 502, headers: NO_STORE });
  }
}
