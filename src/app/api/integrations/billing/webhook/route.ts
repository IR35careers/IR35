import type Stripe from "stripe";
import { BILLING_POLICY_VERSION } from "@/lib/billing/constants";
import { billingProviderConfig, getStripe, stripeObjectId, subscriptionEntitlement, type BillingProviderConfig } from "@/lib/billing/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_WEBHOOK_BYTES = 1_000_000;

async function userForCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const result = await getSupabaseAdmin().from("user_entitlements").select("user_id").eq("provider_customer_id", customerId).maybeSingle();
  if (result.error) throw result.error;
  return (result.data?.user_id as string | undefined) ?? null;
}

async function requireBillingConsent(userId: string, consentKey: string | undefined): Promise<void> {
  if (!consentKey || !/^[a-zA-Z0-9-]{16,80}$/.test(consentKey)) throw new Error("Billing consent is missing.");
  const result = await getSupabaseAdmin()
    .from("billing_consents")
    .select("policy_version, immediate_access_requested, status")
    .eq("user_id", userId)
    .eq("checkout_request_key", consentKey)
    .maybeSingle();
  if (result.error) throw result.error;
  if (result.data?.policy_version !== BILLING_POLICY_VERSION || !result.data.immediate_access_requested || result.data.status === "initiated") throw new Error("Billing consent is incomplete.");
}

async function reconcileCustomerSubscriptions(customerId: string, userId: string, stripe: Stripe, config: BillingProviderConfig, fallbackSubscriptionId: string): Promise<void> {
  const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  const relevant = subscriptions.data.filter((subscription) => subscription.items.data.some((item) => item.price.id === config.proPriceId));
  const current = relevant.find((subscription) => subscription.status === "active" || subscription.status === "trialing")
    ?? relevant.find((subscription) => subscription.status === "past_due" || subscription.status === "unpaid" || subscription.status === "paused")
    ?? relevant.sort((left, right) => right.created - left.created)[0];
  const update = current
    ? subscriptionEntitlement(current.status, current.livemode)
    : { plan: "free" as const, preparation_credits: 25, billing_state: "cancelled" as const };
  if (update.plan === "pro") await requireBillingConsent(userId, current?.metadata.billing_consent_key);
  const result = await getSupabaseAdmin().from("user_entitlements").upsert({
    user_id: userId,
    provider_customer_id: customerId,
    provider_subscription_id: current?.id || fallbackSubscriptionId || null,
    ...update,
    updated_at: new Date().toISOString(),
  });
  if (result.error) throw result.error;
}

async function reconcileEvent(event: Stripe.Event, stripe: Stripe, config: BillingProviderConfig): Promise<void> {
  const admin = getSupabaseAdmin();
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const customerId = stripeObjectId(session.customer);
    const userId = await userForCustomer(customerId);
    if (!userId || !customerId) throw new Error("Checkout session could not be reconciled.");
    if (session.consent?.terms_of_service !== "accepted") throw new Error("Checkout terms were not accepted.");
    const consentKey = session.metadata?.billing_consent_key;
    await requireBillingConsent(userId, consentKey);
    const result = await admin.from("user_entitlements").upsert({ user_id: userId, provider_customer_id: customerId, updated_at: new Date().toISOString() });
    if (result.error) throw result.error;
    const consent = await admin.from("billing_consents").update({ status: "checkout_completed" }).eq("user_id", userId).eq("checkout_request_key", consentKey);
    if (consent.error) throw consent.error;
    return;
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = stripeObjectId(subscription.customer);
    const userId = await userForCustomer(customerId);
    if (!userId && event.type === "customer.subscription.deleted") return;
    if (!userId || !customerId) throw new Error("Subscription could not be reconciled.");
    await reconcileCustomerSubscriptions(customerId, userId, stripe, config, subscription.id);
    return;
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = stripeObjectId(invoice.customer);
    const userId = await userForCustomer(customerId);
    if (!userId || !customerId) throw new Error("Invoice could not be reconciled.");
    await reconcileCustomerSubscriptions(customerId, userId, stripe, config, "");
  }
}

export async function POST(request: Request): Promise<Response> {
  const config = billingProviderConfig();
  if (!config) return Response.json({ error: "Billing webhook is not connected." }, { status: 503, headers: NO_STORE });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_WEBHOOK_BYTES) return Response.json({ error: "Payload too large." }, { status: 413, headers: NO_STORE });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Signature required." }, { status: 400, headers: NO_STORE });

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) return Response.json({ error: "Payload too large." }, { status: 413, headers: NO_STORE });

  let event: Stripe.Event;
  try {
    event = getStripe(config).webhooks.constructEvent(rawBody, signature, config.webhookSecret);
  } catch {
    return Response.json({ error: "Invalid webhook signature." }, { status: 400, headers: NO_STORE });
  }

  const admin = getSupabaseAdmin();
  const previous = await admin.from("billing_webhook_events").select("status, attempts").eq("event_id", event.id).maybeSingle();
  if (previous.error) return Response.json({ error: "Webhook storage is unavailable." }, { status: 500, headers: NO_STORE });
  if (previous.data?.status === "completed") return Response.json({ received: true, duplicate: true }, { headers: NO_STORE });

  const recorded = await admin.from("billing_webhook_events").upsert({
    event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
    status: "processing",
    attempts: Number(previous.data?.attempts ?? 0) + 1,
    last_error: "",
    received_at: new Date().toISOString(),
  });
  if (recorded.error) return Response.json({ error: "Webhook could not be recorded." }, { status: 500, headers: NO_STORE });

  try {
    await reconcileEvent(event, getStripe(config), config);
    const completed = await admin.from("billing_webhook_events").update({ status: "completed", processed_at: new Date().toISOString(), last_error: "" }).eq("event_id", event.id);
    if (completed.error) throw completed.error;
    return Response.json({ received: true }, { headers: NO_STORE });
  } catch {
    await admin.from("billing_webhook_events").update({ status: "failed", last_error: "Entitlement reconciliation failed.", processed_at: null }).eq("event_id", event.id);
    return Response.json({ error: "Webhook processing failed." }, { status: 500, headers: NO_STORE });
  }
}
