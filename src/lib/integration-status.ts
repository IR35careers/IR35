import { billingConfig, stripeManagementConfig } from "@/lib/billing/stripe";
import { resendInboundConfig } from "@/lib/email/resend";
import { openRouterTailoringConfig } from "@/lib/ai/openrouter-tailoring";
import { submissionProviderConfig } from "@/lib/application-submission";
import { applicationWorkerConfig } from "@/lib/application-worker-auth";

export type IntegrationState = "available" | "connected" | "provider_gate" | "not_configured";

export interface IntegrationStatus {
  id: string;
  name: string;
  state: IntegrationState;
  scope: string;
  nextStep: string;
  checkoutAvailable?: boolean;
  managementAvailable?: boolean;
}

function enabled(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

/**
 * Returns capability state only. Secret values, account identifiers and
 * provider errors are deliberately never exposed by this function.
 */
export function getIntegrationStatuses(options?: { includeOperations?: boolean }): IntegrationStatus[] {
  const databaseConnected = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SECRET_KEY
  );
  const reedConnected = Boolean(process.env.REED_API_KEY);
  const adzunaConnected = Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  const inboundConnected = Boolean(enabled(process.env.ENABLE_INBOUND_MAIL) && resendInboundConfig());
  const aiTailoringConnected = Boolean(openRouterTailoringConfig());
  const submissionConnected = Boolean(submissionProviderConfig());
  const persistentWorkerConnected = applicationWorkerConfig().enabled;
  const billingConnected = Boolean(billingConfig());
  const billingManagementConnected = Boolean(stripeManagementConfig());

  const statuses: IntegrationStatus[] = [
    {
      id: "supabase",
      name: "Account and contract database",
      state: databaseConnected ? "connected" : "not_configured",
      scope: "Supabase Auth, public listings and owner-only workspace records.",
      nextStep: databaseConnected ? "No action required." : "Add the three Supabase environment values in Vercel.",
    },
    {
      id: "reed",
      name: "Reed contract feed",
      state: reedConnected ? "connected" : "not_configured",
      scope: "Read-only jobseeker search and role-detail ingestion.",
      nextStep: reedConnected ? "Included in scheduled source refreshes." : "Add REED_API_KEY after Reed authorises the account.",
    },
    {
      id: "adzuna",
      name: "Adzuna contract feed",
      state: adzunaConnected ? "connected" : "not_configured",
      scope: "Read-only UK contract search ingestion.",
      nextStep: adzunaConnected ? "Included in scheduled source refreshes." : "Add ADZUNA_APP_ID and ADZUNA_APP_KEY.",
    },
    {
      id: "mcp",
      name: "MCP developer server",
      state: "available",
      scope: "Read-only public search, contract detail and public-URL analysis.",
      nextStep: "Download from the developer page and install it in an MCP host.",
    },
    {
      id: "inbound_email",
      name: "Recruiter email delivery",
      state: inboundConnected ? "connected" : "provider_gate",
      scope: "Signed inbound webhook, forwarding, consent and message retention.",
      nextStep: inboundConnected ? "Users can activate a private address from their recruiter inbox." : "Verify an inbound domain and add the provider key, signing secret and feature flag.",
    },
    {
      id: "ai_tailoring",
      name: "Role-specific Resume tailoring",
      state: aiTailoringConnected ? "connected" : "provider_gate",
      scope: "Evidence-grounded role tailoring with a local fallback and optional enhanced language-model suggestions.",
      nextStep: aiTailoringConnected ? "Users can request enhanced suggestions and approve each edit." : "Local evidence-based suggestions remain available. Add OPENROUTER_API_KEY for enhanced language suggestions.",
    },
    {
      id: "ats_submission",
      name: "IR35Careers application runner",
      state: submissionConnected ? "connected" : "provider_gate",
      scope: "Queues approved applications and records confirmed employer submissions.",
      nextStep: submissionConnected ? "Application orchestration is enabled." : "Enable application submission after completing the release checks.",
    },
    {
      id: "billing",
      name: "Paid plans and billing",
      state: billingConnected ? "connected" : billingManagementConnected ? "available" : "provider_gate",
      scope: "Checkout, webhook verification, entitlements, refunds and cancellation.",
      nextStep: billingConnected ? "Monitor signed webhook delivery." : billingManagementConnected ? "Existing billing management is available; new checkout remains gated." : "Approve prices, connect a billing sandbox and verify webhooks before enabling checkout.",
      checkoutAvailable: billingConnected,
      managementAvailable: billingManagementConnected,
    },
    {
      id: "messaging",
      name: "WhatsApp and SMS",
      state: "provider_gate",
      scope: "Opt-in recruiter notifications through verified senders.",
      nextStep: "Requires provider approval, explicit consent, revocation and a retention policy.",
    },
  ];
  if (options?.includeOperations) {
    statuses.push({
      id: "persistent_worker",
      name: "Persistent employer portal worker",
      state: persistentWorkerConnected ? "connected" : "provider_gate",
      scope: "Keeps employer browser sessions alive through multi-step forms, account creation and email verification.",
      nextStep: persistentWorkerConnected ? "Approved applications can run outside the website request limit." : "Start the signed worker service and add its connection settings in Vercel.",
    });
  }
  return statuses;
}
