import type { Metadata } from "next";
import { HomeExperience } from "@/components/HomeExperience";
import { buildHomeStructuredData, SITE_ORIGIN } from "@/lib/seo";

export const revalidate = 60;

export const metadata: Metadata = {
  alternates: { canonical: `${SITE_ORIGIN}/` },
};

export default function Home() {
  const structuredData = buildHomeStructuredData();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <HomeExperience />
    </>
  );
}
