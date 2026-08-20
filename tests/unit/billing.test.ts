import { afterEach, describe, expect, it, vi } from "vitest";
import { billingConfig, billingProviderConfig, stripeManagementConfig, stripeObjectId, subscriptionEntitlement } from "@/lib/billing/stripe";
import { POST as checkoutPost } from "@/app/api/billing/checkout/route";
import { POST as webhookPost } from "@/app/api/integrations/billing/webhook/route";
import { getIntegrationStatuses } from "@/lib/integration-status";

afterEach(() => vi.unstubAllEnvs());

function configureBilling() {
  vi.stubEnv("ENABLE_BILLING", "true");
  vi.stubEnv("BILLING_RELEASE_APPROVED", "true");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example_only");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_example_only");
  vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_example_only");
  vi.stubEnv("NEXT_PUBLIC_PRO_PLAN_PRICE_LABEL", "£19/month including VAT");
  vi.stubEnv("NEXT_PUBLIC_PRO_PLAN_FEATURES", "100 monitored roles|Priority workspace exports");
  vi.stubEnv("NEXT_PUBLIC_LEGAL_NAME", "IR35Careers Limited");
  vi.stubEnv("NEXT_PUBLIC_LEGAL_ADDRESS", "1 Example Street, London, W1A 1AA");
  vi.stubEnv("NEXT_PUBLIC_PRIVACY_EMAIL", "privacy@example.test");
}

describe("Stripe billing boundary", () => {
  it("fails closed until every gate and display value is configured", () => {
    vi.stubEnv("ENABLE_BILLING", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example_only");
    expect(billingConfig()).toBeNull();
    configureBilling();
    vi.stubEnv("BILLING_RELEASE_APPROVED", "false");
    expect(billingConfig()).toBeNull();
    expect(stripeManagementConfig()).not.toBeNull();
    expect(billingProviderConfig()).not.toBeNull();
    vi.stubEnv("BILLING_RELEASE_APPROVED", "true");
    expect(billingConfig()).toMatchObject({ proPriceId: "price_example_only", proPriceLabel: "£19/month including VAT", proFeatures: ["100 monitored roles", "Priority workspace exports"] });
  });

  it("never unlocks production Pro from sandbox subscription events", () => {
    expect(subscriptionEntitlement("active", false)).toEqual({ plan: "free", preparation_credits: 25, billing_state: "sandbox" });
    expect(subscriptionEntitlement("canceled", false)).toEqual({ plan: "free", preparation_credits: 25, billing_state: "cancelled" });
    expect(subscriptionEntitlement("active", true)).toEqual({ plan: "pro", preparation_credits: 250, billing_state: "active" });
    expect(subscriptionEntitlement("past_due", true).billing_state).toBe("past_due");
    expect(subscriptionEntitlement("canceled", true).plan).toBe("free");
  });

  it("keeps existing-customer management available when new sales are paused", () => {
    configureBilling();
    vi.stubEnv("BILLING_RELEASE_APPROVED", "false");
    const billing = getIntegrationStatuses().find((item) => item.id === "billing");
    expect(billing).toMatchObject({ state: "available", checkoutAvailable: false, managementAvailable: true });
  });

  it("normalises expandable Stripe identifiers", () => {
    expect(stripeObjectId("cus_123")).toBe("cus_123");
    expect(stripeObjectId({ id: "cus_456" })).toBe("cus_456");
    expect(stripeObjectId(null)).toBeNull();
  });

  it("keeps checkout unavailable when the provider gate is off", async () => {
    vi.stubEnv("ENABLE_BILLING", "false");
    const response = await checkoutPost(new Request("https://example.test/api/billing/checkout", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Checkout is not connected." });
  });

  it("rejects unsigned or oversized webhook requests before processing", async () => {
    configureBilling();
    const unsigned = await webhookPost(new Request("https://example.test/api/integrations/billing/webhook", { method: "POST", body: "{}" }));
    expect(unsigned.status).toBe(400);
    expect(await unsigned.json()).toEqual({ error: "Signature required." });

    const oversized = await webhookPost(new Request("https://example.test/api/integrations/billing/webhook", { method: "POST", headers: { "content-length": "1000001" }, body: "{}" }));
    expect(oversized.status).toBe(413);
  });
});
