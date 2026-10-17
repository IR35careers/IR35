import { Resend } from "resend";

export interface TransactionalEmailConfig {
  apiKey: string;
  from: string;
  replyTo?: string;
}

function extractAddress(value: string): string {
  return (value.match(/<([^<>]+)>/)?.[1] ?? value).trim().toLowerCase();
}

function validMailbox(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(extractAddress(value));
}

export function transactionalEmailConfig(): TransactionalEmailConfig | null {
  if ((process.env.ENABLE_WELCOME_EMAIL ?? "").trim().toLowerCase() !== "true") return null;
  const apiKey = (process.env.RESEND_API_KEY || process.env.EMAIL_PROVIDER_API_KEY || "").trim();
  const from = (process.env.EMAIL_FROM || "IR35Careers <hello@mail.ir35careers.com>").trim();
  const replyTo = (process.env.EMAIL_REPLY_TO || "").trim();
  if (!apiKey.startsWith("re_") || !validMailbox(from) || (replyTo && !validMailbox(replyTo))) return null;
  return { apiKey, from, ...(replyTo ? { replyTo } : {}) };
}

export function getTransactionalResend(config: TransactionalEmailConfig): Resend {
  return new Resend(config.apiKey);
}
