import Stripe from "stripe";
import { legalOperatorConfig } from "@/lib/legal/operator";

let stripeClient: Stripe | null = null;

export interface StripeManagementConfig {
  secretKey: string;
  portalConfigurationId?: string;
  siteUrl: string;
}

export interface BillingProviderConfig extends StripeManagementConfig {
  webhookSecret: string;
  proPriceId: string;
}

export interface BillingConfig extends BillingProviderConfig {
  proPriceLabel: string;
  proFeatures: string[];
}

export function stripeManagementConfig(): StripeManagementConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY || process.env.BILLING_PROVIDER_SECRET_KEY || "";
  if (!secretKey.startsWith("sk_")) return null;
  return {
    secretKey,
    portalConfigurationId: process.env.STRIPE_PORTAL_CONFIGURATION_ID || undefined,
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "https://www.ir35careers.com").replace(/\/$/, ""),
  };
}

export function billingProviderConfig(): BillingProviderConfig | null {
  const management = stripeManagementConfig();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.BILLING_WEBHOOK_SECRET || "";
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID || "";
  if (!management || !webhookSecret.startsWith("whsec_") || !proPriceId.startsWith("price_")) return null;
  return { ...management, webhookSecret, proPriceId };
}

export function billingConfig(): BillingConfig | null {
  const enabled = process.env.ENABLE_BILLING?.toLowerCase() === "true";
  const releaseApproved = process.env.BILLING_RELEASE_APPROVED?.toLowerCase() === "true";
  const provider = billingProviderConfig();
  const proPriceLabel = process.env.NEXT_PUBLIC_PRO_PLAN_PRICE_LABEL || "";
  const proFeatures = (process.env.NEXT_PUBLIC_PRO_PLAN_FEATURES || "").split("|").map((value) => value.trim()).filter(Boolean);
  if (!enabled || !releaseApproved || !legalOperatorConfig() || !provider || !proPriceLabel || proFeatures.length < 2 || proFeatures.length > 6) return null;
  return {
    ...provider,
    proPriceLabel,
    proFeatures,
  };
}

export function getStripe(config: StripeManagementConfig): Stripe {
  if (!stripeClient) stripeClient = new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 12_000 });
  return stripeClient;
}

export type EntitlementUpdate = {
  plan: "free" | "pro";
  preparation_credits: number;
  billing_state: "not_connected" | "sandbox" | "active" | "past_due" | "cancelled";
};

export function subscriptionEntitlement(status: Stripe.Subscription.Status, livemode: boolean): EntitlementUpdate {
  if (!livemode) return { plan: "free", preparation_credits: 25, billing_state: status === "canceled" ? "cancelled" : "sandbox" };
  if (status === "active" || status === "trialing") return { plan: "pro", preparation_credits: 250, billing_state: "active" };
  if (status === "canceled") return { plan: "free", preparation_credits: 25, billing_state: "cancelled" };
  if (status === "past_due" || status === "unpaid" || status === "paused") return { plan: "free", preparation_credits: 25, billing_state: "past_due" };
  return { plan: "free", preparation_credits: 25, billing_state: "not_connected" };
}

export function stripeObjectId(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}
