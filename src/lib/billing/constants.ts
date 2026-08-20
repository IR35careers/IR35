export const BILLING_POLICY_VERSION = "2026-08-20";

export interface CheckoutConsent {
  termsAccepted: true;
  immediateAccessRequested: true;
  billingPolicyVersion: typeof BILLING_POLICY_VERSION;
}
