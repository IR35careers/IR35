import type { Metadata } from "next";
import { AutomationSettings } from "@/components/workspace/AutomationSettings";

export const metadata: Metadata = { title: "Application automation rules", robots: { index: false, follow: false } };

export default function AutomationPage() {
  return <AutomationSettings />;
}

