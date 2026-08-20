import type { Metadata } from "next";
import { BillingManager } from "@/components/workspace/BillingManager";

export const metadata: Metadata = { title: "Plans and billing", robots: { index: false, follow: false } };

export default function BillingPage() {
  return <BillingManager />;
}
