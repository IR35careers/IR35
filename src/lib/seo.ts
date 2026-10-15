import type { Metadata } from "next";
import { CONTACT_EMAIL } from "@/lib/contact";

export const SITE_ORIGIN = "https://www.ir35careers.com";
export const SITE_NAME = "IR35Careers";
export const SITE_DESCRIPTION =
  "Find Inside and Outside IR35 contract jobs across the UK. Compare rates, prepare a role-specific CV and track applications with IR35Careers.";
export const SOCIAL_PROFILES = ["https://www.instagram.com/ir35careers/"] as const;

/** Keep search titles useful at small widths; the on-page heading stays complete. */
export function searchTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  const branded = clean.includes(SITE_NAME) ? clean : `${clean} | ${SITE_NAME}`;
  if (branded.length <= 60) return branded;
  if (clean.length <= 60) return clean;
  return `${clean.slice(0, 59).replace(/\s+\S*$/, "").replace(/[\s,:;|–—-]+$/, "")}…`;
}

export function publicPageMetadata(path: string, title: string, description: string): Metadata {
  const url = new URL(path, SITE_ORIGIN).href;
  const compact = searchTitle(title);
  return {
    title: { absolute: compact },
    description,
    alternates: { canonical: url },
    openGraph: { title: compact, description, url, siteName: SITE_NAME, locale: "en_GB", type: "website", images: [{ url: `${SITE_ORIGIN}/og-image.png`, width: 1200, height: 630, alt: "IR35Careers – UK contract jobs and contractor tools" }] },
    twitter: { card: "summary_large_image", title: compact, description, images: [`${SITE_ORIGIN}/og-image.png`] },
  };
}

/** Add shared SEO defaults without duplicating a page's editorial title/copy. */
export function withPublicPageMetadata(path: string, metadata: Metadata): Metadata {
  return { ...metadata, ...publicPageMetadata(path, typeof metadata.title === "string" ? metadata.title : SITE_NAME, metadata.description ?? SITE_DESCRIPTION) };
}

/** User-controlled listing text must never terminate a JSON-LD script element. */
export function structuredDataJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function buildHomeStructuredData() {
  const organisationId = `${SITE_ORIGIN}/#organisation`;
  const websiteId = `${SITE_ORIGIN}/#website`;
  const logoUrl = `${SITE_ORIGIN}/images/generated/brand/ir35careers-app-icon-512.png`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": websiteId,
      url: `${SITE_ORIGIN}/`,
      name: SITE_NAME,
      alternateName: ["IR35 Careers", "ir35careers.com"],
      description: SITE_DESCRIPTION,
      inLanguage: "en-GB",
      publisher: { "@id": organisationId },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_ORIGIN}/jobs?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": organisationId,
      name: SITE_NAME,
      alternateName: ["IR35 Careers", "ir35careers.com"],
      url: `${SITE_ORIGIN}/`,
      description: SITE_DESCRIPTION,
      logo: {
        "@type": "ImageObject",
        "@id": `${SITE_ORIGIN}/#logo`,
        url: logoUrl,
        contentUrl: logoUrl,
        width: 512,
        height: 512,
        caption: SITE_NAME,
      },
      image: { "@id": `${SITE_ORIGIN}/#logo` },
      email: CONTACT_EMAIL,
      sameAs: [...SOCIAL_PROFILES],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: CONTACT_EMAIL,
        url: `${SITE_ORIGIN}/contact`,
        areaServed: "GB",
        availableLanguage: ["en-GB"],
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${SITE_ORIGIN}/#webpage`,
      url: `${SITE_ORIGIN}/`,
      name: "IR35Careers: UK Contract Jobs and IR35 Tools",
      description: SITE_DESCRIPTION,
      isPartOf: { "@id": websiteId },
      about: { "@id": organisationId },
      primaryImageOfPage: { "@id": `${SITE_ORIGIN}/#logo` },
      inLanguage: "en-GB",
    },
  ];
}
