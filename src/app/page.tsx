import type { Metadata } from "next";
import { headers } from "next/headers";
import { HomeExperience } from "@/components/HomeExperience";
import { buildHomeStructuredData, SITE_DESCRIPTION, SITE_ORIGIN } from "@/lib/seo";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "IR35Careers: UK Contract Jobs and IR35 Tools",
  description: SITE_DESCRIPTION,
  alternates: { canonical: `${SITE_ORIGIN}/` },
};

export default async function Home() {
  const structuredData = buildHomeStructuredData();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      <script
        nonce={nonce}
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <HomeExperience />
    </>
  );
}
