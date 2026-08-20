export type IntegrationState = "available" | "connected" | "provider_gate" | "not_configured";

export interface IntegrationStatus {
  id: string;
  name: string;
  state: IntegrationState;
  scope: string;
  nextStep: string;
}

function enabled(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

/**
 * Returns capability state only. Secret values, account identifiers and
 * provider errors are deliberately never exposed by this function.
 */
export function getIntegrationStatuses(): IntegrationStatus[] {
  const databaseConnected = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SECRET_KEY
  );
  const reedConnected = Boolean(process.env.REED_API_KEY);
  const adzunaConnected = Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  const inboundConnected = Boolean(
    enabled(process.env.ENABLE_INBOUND_MAIL) &&
    process.env.EMAIL_PROVIDER_API_KEY &&
    process.env.INBOUND_MAIL_SIGNING_SECRET
  );
  const billingConnected = Boolean(
    enabled(process.env.ENABLE_BILLING) &&
    process.env.BILLING_PROVIDER_SECRET_KEY &&
    process.env.BILLING_WEBHOOK_SECRET
  );

  return [
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
      nextStep: inboundConnected ? "Monitor webhook receipts and retention jobs." : "Choose an approved provider, verify the domain and add signing credentials.",
    },
    {
      id: "ats_submission",
      name: "Live ATS submission",
      state: "provider_gate",
      scope: "Provider-specific application submission with final human approval.",
      nextStep: "Obtain an authorised ATS partner API and pass sandbox, idempotency and receipt tests.",
    },
    {
      id: "billing",
      name: "Paid plans and billing",
      state: billingConnected ? "connected" : "provider_gate",
      scope: "Checkout, webhook verification, entitlements, refunds and cancellation.",
      nextStep: billingConnected ? "Monitor signed webhook delivery." : "Approve prices, connect a billing sandbox and verify webhooks before enabling checkout.",
    },
    {
      id: "messaging",
      name: "WhatsApp and SMS",
      state: "provider_gate",
      scope: "Opt-in recruiter notifications through verified senders.",
      nextStep: "Requires provider approval, explicit consent, revocation and a retention policy.",
    },
  ];
}
