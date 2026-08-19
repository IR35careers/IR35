import type { ApplicationRecord, ApplicationReceipt, InboxMessage } from "@/lib/workspace/types";

export interface ApplicationProvider {
  readonly id: string;
  readonly mode: "dry_run" | "sandbox" | "live";
  prepare(application: ApplicationRecord): Promise<ApplicationRecord>;
  submit(application: ApplicationRecord, approvalToken: string): Promise<ApplicationReceipt>;
}

export interface InboundMailProvider {
  readonly id: string;
  readonly mode: "disabled" | "sandbox" | "live";
  verifyWebhook(headers: Headers, rawBody: string): Promise<boolean>;
  normalise(rawBody: string): Promise<InboxMessage>;
}

export interface BillingProvider {
  readonly id: string;
  readonly mode: "disabled" | "sandbox" | "live";
  createCheckout(userId: string, plan: "free" | "pro"): Promise<{ url: string }>;
  verifyWebhook(headers: Headers, rawBody: string): Promise<boolean>;
}

export class ProviderUnavailableError extends Error {
  constructor(provider: string) {
    super(`${provider} is not connected. The safe local preview remains available.`);
    this.name = "ProviderUnavailableError";
  }
}

