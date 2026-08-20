import { billingConfig, getStripe } from "@/lib/billing/stripe";
import { BILLING_POLICY_VERSION, type CheckoutConsent } from "@/lib/billing/constants";
import { requestUser } from "@/lib/request-user";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request): Promise<Response> {
  const config = billingConfig();
  if (!config) return Response.json({ error: "Checkout is not connected." }, { status: 503, headers: NO_STORE });
  const auth = await requestUser(request);
  if ("response" in auth) return auth.response;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 2_000) return Response.json({ error: "Request is too large." }, { status: 413, headers: NO_STORE });
  let consent: Partial<CheckoutConsent>;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 2_000) return Response.json({ error: "Request is too large." }, { status: 413, headers: NO_STORE });
    consent = JSON.parse(rawBody) as Partial<CheckoutConsent>;
  } catch {
    return Response.json({ error: "Review and accept the billing terms before checkout." }, { status: 400, headers: NO_STORE });
  }
  if (consent.termsAccepted !== true || consent.immediateAccessRequested !== true || consent.billingPolicyVersion !== BILLING_POLICY_VERSION) {
    return Response.json({ error: "Review and accept the current billing terms before checkout." }, { status: 400, headers: NO_STORE });
  }

  const clientKey = request.headers.get("x-idempotency-key") ?? "";
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(clientKey)) {
    return Response.json({ error: "A valid checkout request identifier is required." }, { status: 400, headers: NO_STORE });
  }

  try {
    const admin = getSupabaseAdmin();
    const existing = await admin.from("user_entitlements").select("provider_customer_id, billing_state").eq("user_id", auth.user.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (["active", "sandbox", "past_due"].includes(existing.data?.billing_state ?? "")) {
      return Response.json({ error: "A billing relationship already exists. Use Manage billing instead." }, { status: 409, headers: NO_STORE });
    }

    const stripe = getStripe(config);
    let customerId = existing.data?.provider_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: auth.user.email,
        metadata: { ir35careers_user_id: auth.user.id },
      }, { idempotencyKey: `customer-${auth.user.id}` });
      customerId = customer.id;
      const saved = await admin.from("user_entitlements").upsert({
        user_id: auth.user.id,
        provider_customer_id: customerId,
        updated_at: new Date().toISOString(),
      });
      if (saved.error) throw saved.error;
    }

    const consentedAt = new Date().toISOString();
    const consentRecord = await admin.from("billing_consents").upsert({
      user_id: auth.user.id,
      checkout_request_key: clientKey,
      policy_version: BILLING_POLICY_VERSION,
      price_label: config.proPriceLabel,
      immediate_access_requested: true,
      status: "initiated",
      consented_at: consentedAt,
    }, { onConflict: "user_id,checkout_request_key" });
    if (consentRecord.error) throw consentRecord.error;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: auth.user.id,
      line_items: [{ price: config.proPriceId, quantity: 1 }],
      success_url: `${config.siteUrl}/billing?checkout=success`,
      cancel_url: `${config.siteUrl}/billing?checkout=cancelled`,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      consent_collection: { terms_of_service: "required" },
      metadata: { ir35careers_user_id: auth.user.id, billing_policy_version: BILLING_POLICY_VERSION, billing_consent_key: clientKey, immediate_access_requested: "true" },
      subscription_data: { metadata: { ir35careers_user_id: auth.user.id, billing_policy_version: BILLING_POLICY_VERSION, billing_consent_key: clientKey } },
    }, { idempotencyKey: `checkout-${auth.user.id}-${clientKey}` });

    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    const linkedConsent = await admin.from("billing_consents").update({
      status: "checkout_created",
      provider_checkout_session_id: session.id,
    }).eq("user_id", auth.user.id).eq("checkout_request_key", clientKey);
    if (linkedConsent.error) throw linkedConsent.error;
    return Response.json({ url: session.url }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Checkout could not be started. No charge was made." }, { status: 502, headers: NO_STORE });
  }
}
