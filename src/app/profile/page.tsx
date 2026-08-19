import type { Metadata } from "next";
import { ContractorProfile } from "@/components/workspace/ContractorProfile";

export const metadata: Metadata = { title: "Contractor profile", robots: { index: false, follow: false } };

export default function ProfilePage() {
  return <ContractorProfile />;
}

