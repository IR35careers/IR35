import type { Metadata } from "next";
import { ContractorProfile } from "@/components/workspace/ContractorProfile";
import { safeApplicationReturnPath } from "@/lib/application-profile-return";

export const metadata: Metadata = { title: "Contractor profile", robots: { index: false, follow: false } };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <ContractorProfile
      returnTo={safeApplicationReturnPath(params.returnTo)}
    />
  );
}
